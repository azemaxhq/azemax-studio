/**
 * Abort helpers for the AI runtime.
 *
 * `AIAbortController` wraps the native AbortController with a named abort
 * reason and a `isAbortError` helper so callers can distinguish a user-cancelled
 * request from a genuine failure without string-matching error messages.
 *
 * `AIAbortManager` keys controllers by request id so a single owner can
 * cancel many in-flight requests (e.g. "new chat" aborts the active chat and
 * every editor suggestion at once).
 */

export type AbortReason = 'user' | 'new-chat' | 'regenerate' | 'superseded' | 'unmount';

export class AIAbortController {
    private controller: AbortController;
    private reason: AbortReason | null = null;

    constructor(reason?: AbortReason) {
        this.controller = new AbortController();
        if (reason) this.reason = reason;
    }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    get aborted(): boolean {
        return this.controller.signal.aborted;
    }

    get abortReason(): AbortReason | null {
        return this.reason;
    }

    abort(reason?: AbortReason): void {
        if (this.controller.signal.aborted) return;
        if (reason) this.reason = reason;
        this.controller.abort();
    }
}

export function isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException) return error.name === 'AbortError';
    const err = error as { name?: string };
    if (typeof err.name === 'string' && err.name === 'AbortError') return true;
    return String((error as { message?: string })?.message ?? '').toLowerCase().includes('abort');
}

export class AIAbortManager {
    private map = new Map<string, AIAbortController>();

    /** Returns an existing live controller for `key`, or creates one. */
    get(key: string): AIAbortController {
        let entry = this.map.get(key);
        if (!entry || entry.aborted) {
            entry = new AIAbortController();
            this.map.set(key, entry);
        }
        return entry;
    }

    /** Aborts (and removes) the controller for `key` if present. */
    abort(key: string, reason?: AbortReason): void {
        const entry = this.map.get(key);
        if (entry) {
            entry.abort(reason);
            this.map.delete(key);
        }
    }

    /** Aborts every tracked controller. */
    abortAll(reason?: AbortReason): void {
        for (const [key, entry] of this.map) {
            entry.abort(reason);
            this.map.delete(key);
        }
    }

    /** Removes a controller from tracking without aborting it (request finished). */
    release(key: string): void {
        this.map.delete(key);
    }

    /** True when `key` has a live (non-aborted) controller. */
    has(key: string): boolean {
        const entry = this.map.get(key);
        return Boolean(entry && !entry.aborted);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}