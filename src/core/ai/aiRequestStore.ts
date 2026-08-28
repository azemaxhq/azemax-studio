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

// Store: map of all active requests (idle/success/error are not kept long; we keep last per operation for UI)
const requests = new Map<string, AIRequest>();
// Latest active requestId per operation (for concurrent protection per operation)
const latestByOperation = new Map<AIOperationType, string>();

const listeners = new Set<Listener>();

function emit() {
    for (const l of listeners) l();
}

function now() {
    return Date.now();
}

export const AIRequestStore = {
    // Create and immediately set to thinking — caller must do this BEFORE await provider()
    startRequest(operation: AIOperationType, initialStatus: AIRequestStatus = 'thinking'): string {
        const id = nextId();
        const req: AIRequest = {
            id,
            operation,
            status: initialStatus,
            createdAt: now(),
            updatedAt: now(),
        };
        requests.set(id, req);
        latestByOperation.set(operation, id);
        traceAIRequest(operation, id, 'START', { status: initialStatus });
        emit();
        return id;
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
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'COMPLETE', { status: 'success' });
        emit();
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
        req.error = error ?? null;
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'ERROR', { status: 'error', error });
        emit();
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
        req.updatedAt = now();
        traceAIRequest(req.operation, id, 'CANCEL', { status: 'cancelled' });
        emit();
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
};
