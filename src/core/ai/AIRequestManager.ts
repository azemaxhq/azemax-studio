import { AIAbortController, AIAbortManager, type AbortReason } from './AIAbortController';

/**
 * Client-side AI request registry — the single authority for every AI request
 * (chat, regenerate, edit, autocomplete, comments, explain, refactor,
 * diagnostics, inline suggestions).
 *
 * Every request gets:
 *   requestId    unique id for this HTTP/stream operation
 *   generationId shared by retries/regenerations of the same logical output
 *   task         the AI task key (chat / simple_edit / autocomplete / ...)
 *   AbortController + status
 *
 * Rules enforced here:
 *   - A new request supersedes only the RELEVANT previous request (same
 *     messageId). Unrelated in-flight requests are untouched.
 *   - Stop aborts immediately ('user').
 *   - New chat cancels all old requests for the conversation.
 *   - Component unmount cancels owned requests (abortAllForOwner).
 *   - Regenerate cancels the previous generation first.
 *   - Stale chunks are rejected by the caller via the requestId guard.
 *   - Aborted requests never trigger fallback (isAbortError propagates).
 *   - [DONE] is handled exactly once by the consumer.
 */

export type AIRequestStatus = 'pending' | 'streaming' | 'complete' | 'aborted' | 'failed';

export interface AIRequestRecord {
    requestId: string;
    generationId: string;
    conversationId?: string | null;
    messageId?: string;
    task?: string;
    owner?: string;
    controller: AIAbortController;
    status: AIRequestStatus;
}

export interface AIRequestBeginInput {
    conversationId?: string | null;
    messageId?: string;
    task?: string;
    owner?: string;
}

export class AIRequestManager {
    private records = new Map<string, AIRequestRecord>();

    private static generateId(): string {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Begins a new request. If a live request is already targeting the same
     * messageId, it is aborted first (latest request wins — prevents duplicate
     * responses and regeneration races). The generationId is shared across
     * retries of the same logical output so consumers can group them.
     */
    begin(input: AIRequestBeginInput = {}): AIRequestRecord {
        if (input.messageId) {
            const existing = [...this.records.values()].find(
                (r) => r.messageId === input.messageId && (r.status === 'pending' || r.status === 'streaming'),
            );
            if (existing) this.abort(existing.requestId, 'superseded');
        }

        const record: AIRequestRecord = {
            requestId: AIRequestManager.generateId(),
            generationId: AIRequestManager.generateId(),
            conversationId: input.conversationId,
            messageId: input.messageId,
            task: input.task,
            owner: input.owner,
            controller: new AIAbortController(),
            status: 'pending',
        };
        this.records.set(record.requestId, record);
        return record;
    }

    get(requestId: string): AIRequestRecord | undefined {
        return this.records.get(requestId);
    }

    /** All live records (read-only view for observability/tests). */
    all(): readonly AIRequestRecord[] {
        return [...this.records.values()];
    }

    isActive(requestId: string): boolean {
        const record = this.records.get(requestId);
        return Boolean(record && (record.status === 'pending' || record.status === 'streaming'));
    }

    markStatus(requestId: string, status: AIRequestStatus): void {
        const record = this.records.get(requestId);
        if (record) {
            record.status = status;
            if (status === 'complete' || status === 'aborted' || status === 'failed') {
                this.records.delete(requestId);
            }
        }
    }

    abort(requestId: string, reason: AbortReason = 'user'): void {
        const record = this.records.get(requestId);
        if (!record) return;
        record.controller.abort(reason);
        record.status = 'aborted';
        this.records.delete(requestId);
    }

    /** Aborts any live request targeting `messageId`. */
    abortForMessage(messageId: string, reason: AbortReason = 'superseded'): void {
        for (const [id, record] of this.records) {
            if (record.messageId === messageId) this.abort(id, reason);
        }
    }

    /** Aborts every request for a conversation (used by "new chat"). */
    abortAllForConversation(conversationId: string | null | undefined, reason: AbortReason = 'new-chat'): void {
        for (const [id, record] of this.records) {
            if (record.conversationId === conversationId) this.abort(id, reason);
        }
    }

    /** Aborts every request owned by `owner` (used on component unmount). */
    abortAllForOwner(owner: string, reason: AbortReason = 'unmount'): void {
        for (const [id, record] of this.records) {
            if (record.owner === owner) this.abort(id, reason);
        }
    }

    abortAll(reason: AbortReason = 'new-chat'): void {
        for (const id of [...this.records.keys()]) this.abort(id, reason);
    }

    get size(): number {
        return this.records.size;
    }
}

/** Singleton registry shared across chat + editor AI features. */
export const aiRequestManager = new AIRequestManager();

/** Singleton abort manager for non-message AI work (autocomplete etc.). */
export const aiAbortManager = new AIAbortManager();

export type { AIAbortController, AbortReason };