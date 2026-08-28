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
