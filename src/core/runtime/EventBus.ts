/**
 * EventBus
 *
 * A tiny typed, disposable event emitter. Unlike window.EventTarget it returns
 * unsubscribe functions and never accumulates listeners silently: every
 * subscription is registered on a DisposableStore owned by the caller, so
 * StrictMode remounts and component teardown always remove the listener.
 */

import { DisposableStore, toDisposable, type IDisposable } from './DisposableStore';

export type EventHandler<T> = (payload: T) => void;

export class EventBus<TEvents extends Record<string, unknown>> {
    private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
    readonly store = new DisposableStore();

    /** Subscribe to an event. Returns a dispose handle. */
    on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): IDisposable {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(handler as EventHandler<unknown>);
        return toDisposable(() => {
            const s = this.handlers.get(event);
            s?.delete(handler as EventHandler<unknown>);
        });
    }

    /** Subscribe AND register on this bus's own store so it is cleaned up with the bus. */
    onWithStore<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): IDisposable {
        const disposable = this.on(event, handler);
        this.store.add(disposable);
        return disposable;
    }

    emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
        const set = this.handlers.get(event);
        if (!set) return;
        // Copy so handlers may unsubscribe during dispatch without corrupting iteration.
        for (const handler of Array.from(set)) {
            try {
                handler(payload);
            } catch {
                // A throwing handler must not break delivery to the others.
            }
        }
    }

    clear(): void {
        this.handlers.clear();
    }

    dispose(): void {
        this.store.dispose();
        this.handlers.clear();
    }
}
