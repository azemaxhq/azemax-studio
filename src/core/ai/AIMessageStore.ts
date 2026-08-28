import type { RuntimeMessage } from './types';

/**
 * Immutable, structurally-shared message store.
 *
 * Only the active (streaming) message's object is replaced on each update;
 * completed messages keep their identity so memoized components never
 * re-render when a different message streams. `activeMessageId` tracks the
 * single message that is allowed to change.
 */
export class AIMessageStore {
    private list: RuntimeMessage[] = [];
    private activeId: string | null = null;

    getMessages(): readonly RuntimeMessage[] {
        return this.list;
    }

    get activeMessageId(): string | null {
        return this.activeId;
    }

    get(id: string): RuntimeMessage | undefined {
        return this.list.find((m) => m.id === id);
    }

    findIndex(id: string): number {
        return this.list.findIndex((m) => m.id === id);
    }

    addMessage(input: { role: RuntimeMessage['role']; content?: string; id?: string }): RuntimeMessage {
        const msg: RuntimeMessage = {
            id: input.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            role: input.role,
            content: input.content || '',
            status: input.content ? 'complete' : 'pending',
        };
        this.list = [...this.list, msg];
        return msg;
    }

    /** Designates the only message that may mutate during streaming. */
    setActive(id: string | null): void {
        this.activeId = id;
    }

    /**
     * Replaces `id`'s content while preserving every other message's identity.
     * Returns the updated message, or undefined when `id` is unknown.
     */
    updateContent(id: string, content: string): RuntimeMessage | undefined {
        if (this.activeId !== null && id !== this.activeId) return undefined;
        let updated: RuntimeMessage | undefined;
        this.list = this.list.map((m) => {
            if (m.id === id) {
                updated = { ...m, content, status: content ? 'streaming' : m.status };
                return updated;
            }
            return m;
        });
        return updated;
    }

    setStatus(id: string, status: RuntimeMessage['status']): void {
        this.list = this.list.map((m) => (m.id === id ? { ...m, status } : m));
    }

    /** Removes `id` and everything after it (used by regenerate). */
    removeFrom(id: string): void {
        const index = this.findIndex(id);
        if (index === -1) return;
        this.list = this.list.slice(0, index);
        if (this.activeId && this.findIndex(this.activeId) === -1) this.activeId = null;
    }

    reset(initial: RuntimeMessage[] = []): void {
        this.list = [...initial];
        this.activeId = null;
    }
}