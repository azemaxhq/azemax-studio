const { STREAM_IDLE_TIMEOUT_MS } = require('./aiStream.cjs');

/**
 * Server-side registry of in-flight AI streaming requests.
 *
 * Guarantees:
 * - every active stream is tracked (requestId -> { controller, idleTimer })
 * - idle timeouts are reset per chunk and cleared on completion
 * - client disconnects abort the upstream fetch
 * - on server shutdown all active streams are aborted (no orphan requests)
 */
class AIRequestManager {
    constructor() {
        /** @type {Map<string, { controller: AbortController, idleTimer: NodeJS.Timeout|null, onClientAbort: Function, clientSignal: AbortSignal }>} */
        this.active = new Map();
    }

    /**
     * Registers a stream request and returns the per-attempt controller.
     * The controller is wired to the client's abort signal (once).
     */
    register(requestId, clientSignal) {
        const controller = new AbortController();
        const onClientAbort = () => {
            if (!controller.signal.aborted) controller.abort();
        };
        clientSignal.addEventListener('abort', onClientAbort, { once: true });

        const record = { controller, idleTimer: null, onClientAbort, clientSignal };
        this.active.set(requestId, record);
        return controller;
    }

    /**
     * Resets the idle timer for a request (call on every received chunk).
     */
    touch(requestId) {
        const record = this.active.get(requestId);
        if (!record) return;
        if (record.idleTimer) clearTimeout(record.idleTimer);
        record.idleTimer = setTimeout(() => {
            if (!record.controller.signal.aborted) {
                record.controller.abort(new Error('Provider stream idle timeout'));
            }
        }, STREAM_IDLE_TIMEOUT_MS);
    }

    /**
     * Detaches client-abort wiring (must be called when the request completes).
     */
    release(requestId) {
        const record = this.active.get(requestId);
        if (!record) return;
        if (record.idleTimer) clearTimeout(record.idleTimer);
        record.clientSignal.removeEventListener('abort', record.onClientAbort);
        this.active.delete(requestId);
    }

    /**
     * Aborts a request's upstream fetch (e.g. client went away).
     */
    abort(requestId) {
        const record = this.active.get(requestId);
        if (record && !record.controller.signal.aborted) record.controller.abort();
    }

    /** Aborts every tracked request. Used on server shutdown. */
    abortAll() {
        for (const record of this.active.values()) {
            if (!record.controller.signal.aborted) record.controller.abort();
        }
    }

    get size() {
        return this.active.size;
    }
}

module.exports = { AIRequestManager, aiRequestManager: new AIRequestManager() };