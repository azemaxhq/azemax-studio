/**
 * Single Source of Truth for AI request lifecycle — outside React.
 * React subscribes via useSyncExternalStore, never copies into random useState/useRef.
 *
 * Each request: { id, operation, status, createdAt, updatedAt, error }
 * - operation: chat | explanation | edit | comment | ...
 * - status: idle | preparing | thinking | generating | streaming | applying | success | error | cancelled
 *
 * Guarantees:
 * - ONE owner per request (store), UI just renders store.getSnapshot()
 * - request A finally() cannot clear request B (isCurrent check)
 * - No global boolean, no deferredStreamingText as source of truth
 * - STATE MUST CHANGE BEFORE async request starts (startRequest -> thinking before await provider)
 */

import { traceAIRequest } from './aiLifecycleDebug';

export type AIRequestStatus =
    | 'idle'
    | 'preparing'
    | 'thinking'
    | 'generating'
    | 'streaming'
    | 'applying'
    | 'success'
    | 'error'
    | 'cancelled';

/**
 * Explicit agent lifecycle phases.
 *
 * `status` answers "is a request running?"; `phase` answers "what is it
 * actually doing right now?". Keeping them separate is what lets the UI say
 * "Inspecting workspace" instead of an indeterminate spinner, and what makes
 * "completed" impossible to assert while tool work is still pending.
 *
 * `idle` and the three terminal phases mirror the request status; everything
 * in between is real, emitted execution.
 */
export type AgentTaskPhase =
    | 'idle'
    | 'understanding'
    | 'inspecting'
    | 'planning'
    | 'executing'
    | 'validating'
    | 'summarizing'
    | 'completed'
    | 'failed'
    | 'cancelled';

/** Phases during which work is still in flight. */
export const ACTIVE_AGENT_PHASES: ReadonlySet<AgentTaskPhase> = new Set<AgentTaskPhase>([
    'understanding',
    'inspecting',
    'planning',
    'executing',
    'validating',
    'summarizing',
]);

export const isTerminalPhase = (p: AgentTaskPhase): boolean =>
    p === 'completed' || p === 'failed' || p === 'cancelled' || p === 'idle';

/**
 * One internal execution event.
 *
 * These are ORCHESTRATION facts, never assistant prose. They drive the task
 * progress UI only — they are never committed to conversation history as an
 * assistant message.
 */
export interface AgentProgressEvent {
    /** Stable id of the task that emitted it (prevents stale cross-task writes). */
    taskId: string;
    phase: AgentTaskPhase;
    /** Stage label suitable for display ("Inspecting workspace"). */
    label: string;
    /** Optional secondary detail ("8 files", "index.html"). */
    detail?: string;
    /** The tool that produced this event, when tool-driven. */
    tool?: string;
    status: 'running' | 'done' | 'error';
    at: number;
}

export type AIOperationType =
    | 'chat'
    | 'explanation'
    | 'explain-file'
    | 'explain-selection'
    | 'edit'
    | 'comment'
    | 'remove-comment'
    | 'generate'
    | 'fix'
    | 'refactor';

export interface AIRequest {
    id: string;
    operation: AIOperationType;
    status: AIRequestStatus;
    /** Explicit agent lifecycle phase (defaults to 'idle' for plain chat). */
    phase: AgentTaskPhase;
    /** Bounded internal execution events for this task. */
    progress: AgentProgressEvent[];
    createdAt: number;
    updatedAt: number;
    error?: string | null;
}

type Listener = () => void;

let requestCounter = 0;
function nextId(): string {
    requestCounter += 1;
    return `ai-req-${Date.now()}-${requestCounter}`;
}

/** Bound the per-task progress log so a long run cannot grow it forever. */
const MAX_PROGRESS_EVENTS = 60;

// Store: map of all active requests (idle/success/error are not kept long; we keep last per operation for UI)
const requests = new Map<string, AIRequest>();
// Latest active requestId per operation (for concurrent protection per operation)
const latestByOperation = new Map<AIOperationType, string>();

const listeners = new Set<Listener>();
const progressListeners = new Set<(taskId: string, events: AgentProgressEvent[]) => void>();

function emit() {
    for (const l of listeners) l();
}

function emitProgress(taskId: string) {
    const req = requests.get(taskId);
    if (!req) return;
    for (const l of Array.from(progressListeners)) {
        try {
            l(taskId, req.progress);
        } catch (e) {
            console.warn('[AIRequestStore] progress listener failed:', e);
        }
    }
}

function now() {
    return Date.now();
}

/** Map a request status onto the agent phase it implies. */
const PHASE_FOR_STATUS: Partial<Record<AIRequestStatus, AgentTaskPhase>> = {
    thinking: 'understanding',
    preparing: 'understanding',
    generating: 'executing',
    streaming: 'summarizing',
    applying: 'executing',
    success: 'completed',
    error: 'failed',
    cancelled: 'cancelled',
};

export const AIRequestStore = {
    // Create and immediately set to thinking — caller must do this BEFORE await provider()
    startRequest(operation: AIOperationType, initialStatus: AIRequestStatus = 'thinking', phase?: AgentTaskPhase): string {
        const id = nextId();
        const req: AIRequest = {
            id,
            operation,
            status: initialStatus,
            phase: phase ?? PHASE_FOR_STATUS[initialStatus] ?? 'understanding',
            progress: [],
            createdAt: now(),
            updatedAt: now(),
        };
        requests.set(id, req);
        latestByOperation.set(operation, id);
        traceAIRequest(operation, id, 'START', { status: initialStatus });
        emit();
        return id;
    },

    /**
     * Move a task to an explicit lifecycle phase.
     *
     * The status and phase are updated together so the loading indicator and
     * the progress label can never disagree. A terminal phase also sets the
     * matching terminal status, which is what guarantees the spinner clears.
     */
    setPhase(id: string, phase: AgentTaskPhase, label?: string, detail?: string): void {
        const req = requests.get(id);
        if (!req) return;
        // Stale guard: only the current request for its operation may advance.
        if (latestByOperation.get(req.operation) !== id) return;
        // A terminal task is immutable. Guarding on the CURRENT STATUS (not the
        // phase) means a task marked success/error/cancelled can never be
        // dragged back into an active phase by a late async callback.
        if (req.status === 'success' || req.status === 'error' || req.status === 'cancelled') return;
        if (phase === 'idle') return;
        req.phase = phase;
        if (phase === 'completed') req.status = 'success';
        else if (phase === 'failed') req.status = 'error';
        else if (phase === 'cancelled') req.status = 'cancelled';
        else {
            req.status = phase === 'summarizing' ? 'streaming' : phase === 'validating' ? 'applying' : 'generating';
        }
        req.updatedAt = now();
        if (label) {
            const event: AgentProgressEvent = {
                taskId: id,
                phase,
                label,
                ...(detail !== undefined ? { detail } : {}),
                status: 'running',
                at: req.updatedAt,
            };
            req.progress = [...req.progress, event].slice(-MAX_PROGRESS_EVENTS);
        }
        traceAIRequest(req.operation, id, 'PHASE', { phase });
        emit();
        emitProgress(id);
    },

    /**
     * Record an internal execution event against a task.
     *
     * Events from a task that is no longer current are DROPPED, which is what
     * prevents a stale async callback from painting progress onto a newer task.
     */
    emitProgressEvent(
        id: string,
        event: Omit<AgentProgressEvent, 'taskId' | 'at'> & { at?: number },
    ): void {
        const req = requests.get(id);
        if (!req) return;
        if (latestByOperation.get(req.operation) !== id) return;
        req.progress = [...req.progress, { ...event, taskId: id, at: event.at ?? now() }].slice(-MAX_PROGRESS_EVENTS);
        req.updatedAt = now();
        emitProgress(id);
    },

    getProgress(id: string): AgentProgressEvent[] {
        return requests.get(id)?.progress ?? [];
    },

    getPhase(id: string): AgentTaskPhase {
        return requests.get(id)?.phase ?? 'idle';
    },

    subscribeProgress(listener: (taskId: string, events: AgentProgressEvent[]) => void): () => void {
        progressListeners.add(listener);
        return () => {
            progressListeners.delete(listener);
        };
    },

    /** Record a genuinely user-visible reason a task failed. */
    failTask(id: string, error?: string | null): void {
        const req = requests.get(id);
        if (!req) return;
        if (latestByOperation.get(req.operation) !== id) {
            requests.delete(id);
            emit();
            return;
        }
        req.status = 'error';
        req.phase = 'failed';
        req.error = error ?? null;
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'ERROR', { status: 'error', error });
        emit();
        emitProgress(id);
        requestAnimationFrame(() => {
            if (requests.get(id)?.status === 'error') {
                requests.delete(id);
                if (latestByOperation.get(req.operation) === id) latestByOperation.delete(req.operation);
                emit();
            }
        });
    },

    /** Mark a task cancelled (user stop or timeout). */
    cancelTask(id: string, reason?: string | null): void {
        const req = requests.get(id);
        if (!req) return;
        req.status = 'cancelled';
        req.phase = 'cancelled';
        if (reason !== undefined) req.error = reason ?? null;
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'CANCEL', { status: 'cancelled', reason });
        emit();
        emitProgress(id);
        requests.delete(id);
        if (latestByOperation.get(req.operation) === id) latestByOperation.delete(req.operation);
        emit();
    },

    updateRequest(id: string, status: AIRequestStatus, error?: string | null) {
        const req = requests.get(id);
        if (!req) return;
        // Only allow updates if this is still the latest for its operation, or if status is terminal
        // For streaming, we want to allow updates even if a newer request of same operation started? No — stale should be ignored
        const latestId = latestByOperation.get(req.operation);
        if (latestId !== id && status !== 'error' && status !== 'cancelled') {
            // Stale request trying to update — ignore (prevents A clearing B)
            return;
        }
        req.status = status;
        // Keep the phase in lockstep with the status unless a phase was
        // already advanced past the generic mapping (an agent run sets
        // explicit phases via setPhase).
        const implied = PHASE_FOR_STATUS[status];
        if (implied && req.phase === 'idle') req.phase = implied;
        req.updatedAt = now();
        if (error !== undefined) req.error = error;
        const eventMap: Record<string, any> = {
            thinking: 'START',
            generating: 'PROVIDER_REQUEST',
            streaming: 'FIRST_TOKEN',
            applying: 'APPLYING',
            success: 'COMPLETE',
            error: 'ERROR',
            cancelled: 'CANCEL',
        };
        traceAIRequest(req.operation, id, (eventMap[status] ?? status.toUpperCase()) as any, { status });
        emit();
        // Auto-cleanup terminal states after a short microtask (so UI can see success briefly if it wants)
        if (status === 'success' || status === 'error' || status === 'cancelled') {
            // Keep for one frame then remove from active, but don't immediately delete so UI can render success
            // Instead, we keep it as success/error for one tick, then caller should completeRequest to remove
            // For now, we keep it until completeRequest is called or a new request for same operation starts
        }
    },

    completeRequest(id: string) {
        const req = requests.get(id);
        if (!req) return;
        // Only the current request for its operation can be completed as success
        if (latestByOperation.get(req.operation) !== id) {
            requests.delete(id);
            emit();
            return;
        }
        req.status = 'success';
        req.phase = 'completed';
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'COMPLETE', { status: 'success' });
        emit();
        emitProgress(id);
        // Remove on next frame so UI can see success briefly, no artificial minimum duration
        requestAnimationFrame(() => {
            if (requests.get(id)?.status === 'success') {
                requests.delete(id);
                if (latestByOperation.get(req.operation) === id) latestByOperation.delete(req.operation);
                emit();
            }
        });
    },

    failRequest(id: string, error?: string) {
        const req = requests.get(id);
        if (!req) return;
        if (latestByOperation.get(req.operation) !== id) {
            requests.delete(id);
            emit();
            return;
        }
        req.status = 'error';
        req.phase = 'failed';
        req.error = error ?? null;
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'ERROR', { status: 'error', error });
        emit();
        emitProgress(id);
        requestAnimationFrame(() => {
            if (requests.get(id)?.status === 'error') {
                requests.delete(id);
                if (latestByOperation.get(req.operation) === id) latestByOperation.delete(req.operation);
                emit();
            }
        });
    },

    cancelRequest(id: string) {
        const req = requests.get(id);
        if (!req) return;
        // Allow cancel even if not latest (user explicitly cancelled)
        req.status = 'cancelled';
        req.phase = 'cancelled';
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'CANCEL', { status: 'cancelled' });
        emit();
        emitProgress(id);
        requests.delete(id);
        if (latestByOperation.get(req.operation) === id) latestByOperation.delete(req.operation);
        emit();
    },

    // For finally() cleanup — only clears if this id is still current
    isCurrent(id: string): boolean {
        const req = requests.get(id);
        if (!req) return false;
        return latestByOperation.get(req.operation) === id;
    },

    getRequest(id: string): AIRequest | undefined {
        return requests.get(id);
    },

    getActiveRequestForOperation(operation: AIOperationType): AIRequest | undefined {
        const id = latestByOperation.get(operation);
        if (!id) return undefined;
        return requests.get(id);
    },

    getSnapshot(): Map<string, AIRequest> {
        return new Map(requests);
    },

    subscribe(listener: Listener): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    // For testing
    _clearForTests() {
        requests.clear();
        latestByOperation.clear();
        emit();
    },

    /** Test/observability helper: how many progress listeners are attached. */
    _progressListenerCount(): number {
        return progressListeners.size;
    },
};
