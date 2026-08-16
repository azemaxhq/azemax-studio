/**
 * CancellationToken / CancellationTokenSource
 *
 * A thin, type-safe cancellation primitive backed by AbortController. Every
 * asynchronous operation should accept a token, listen for its signal, and
 * reject its promise with a CancelledError when aborted. Consumers use a
 * request/generation id (see SingleFlight / stale rejection) so a cancelled
 * operation can never update current state.
 */

export class CancelledError extends Error {
    constructor(message = 'Operation cancelled') {
        super(message);
        this.name = 'CancelledError';
    }
}

export class CancellationTokenSource {
    private readonly controller = new AbortController();

    get token(): AbortSignal {
        return this.controller.signal;
    }

    get isCancellationRequested(): boolean {
        return this.controller.signal.aborted;
    }

    cancel(): void {
        this.controller.abort();
    }

    dispose(): void {
        this.controller.abort();
    }
}

export function throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new CancelledError();
}

export function onAbort(signal: AbortSignal, callback: () => void): () => void {
    if (signal.aborted) {
        callback();
        return () => {};
    }
    signal.addEventListener('abort', callback, { once: true });
    return () => signal.removeEventListener('abort', callback);
}
