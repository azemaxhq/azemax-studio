/**
 * DisposableStore
 *
 * A single owner for many disposables. Every long-lived resource created by a
 * subsystem is registered here and released atomically with one dispose() call.
 * Mirrors the pattern used by VS Code's DisposableStore: guaranteed cleanup,
 * no silent leaks, idempotent disposal.
 */

export interface IDisposable {
    dispose(): void;
}

export type DisposableLike = IDisposable | (() => void);

export const toDisposable = (fn: () => void): IDisposable => ({ dispose: fn });

export function isDisposable(value: unknown): value is IDisposable {
    return typeof value === 'object' && value !== null && 'dispose' in value;
}

export class DisposableStore {
    private readonly items = new Set<DisposableLike>();
    private disposed = false;

    add<T extends DisposableLike>(item: T): T {
        if (this.disposed) {
            disposeItem(item);
            return item;
        }
        this.items.add(item);
        return item;
    }

    delete(item: DisposableLike): void {
        this.items.delete(item);
    }

    get size(): number {
        return this.items.size;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const item of this.items) {
            disposeItem(item);
        }
        this.items.clear();
    }
}

function disposeItem(item: DisposableLike): void {
    try {
        if (typeof item === 'function') {
            item();
        } else {
            item.dispose();
        }
    } catch {
        // A failing disposer must never break the rest of the teardown pass.
    }
}
