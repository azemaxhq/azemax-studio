import { useEffect, useRef, useCallback } from 'react';

export function useDebounceCallback<T extends (...args: any[]) => unknown>(
    callback: T,
    delay: number
): (...args: Parameters<T>) => void {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const callbackRef = useRef(callback);

    // Keep the latest callback reference
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    // Never fire a debounced call after the owner unmounts — a pending timer
    // must not trigger a stale setState/side-effect on a disposed component.
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, []);

    return useCallback((...args: Parameters<T>) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            callbackRef.current(...args);
        }, delay);
    }, [delay]);
}

/**
 * Keyed debounce: one independent timer per key (e.g. per file id).
 * Fixes silent data loss when a shared timer is re-armed for key B while
 * key A's save is still pending — each key's callback fires with its own
 * latest args. `flush(key)` runs a pending callback synchronously (used on
 * file switch / pagehide so no edit is ever discarded); `flushAll()` drains
 * every pending callback (used on unmount).
 */
export function useKeyedDebounceCallback<T extends (...args: any[]) => unknown>(
    callback: T,
    delay: number
): {
    call: (key: string, ...args: Parameters<T>) => void;
    flush: (key: string) => boolean;
    flushAll: () => void;
} {
    const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const pendingRef = useRef(new Map<string, Parameters<T>>());
    const callbackRef = useRef(callback);

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    // Never fire after unmount (flushAll is the explicit, owner-driven path).
    useEffect(() => {
        const timers = timersRef.current;
        const pending = pendingRef.current;
        return () => {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
            pending.clear();
        };
    }, []);

    const flush = useCallback((key: string): boolean => {
        const timers = timersRef.current;
        const pending = pendingRef.current;
        const t = timers.get(key);
        if (!t) return false;
        clearTimeout(t);
        timers.delete(key);
        const args = pending.get(key);
        pending.delete(key);
        if (args) callbackRef.current(...args);
        return true;
    }, []);

    const flushAll = useCallback(() => {
        for (const key of Array.from(timersRef.current.keys())) flush(key);
    }, [flush]);

    const call = useCallback((key: string, ...args: Parameters<T>) => {
        const timers = timersRef.current;
        const pending = pendingRef.current;
        const prev = timers.get(key);
        if (prev) clearTimeout(prev);
        pending.set(key, args);
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            const a = pending.get(key);
            pending.delete(key);
            if (a) callbackRef.current(...a);
        }, delay));
    }, [delay]);

    return { call, flush, flushAll };
}
