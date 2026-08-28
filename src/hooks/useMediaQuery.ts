import { useSyncExternalStore } from 'react';

// Cached MediaQueryList instances so every use of the same query shares one
// native matchMedia object (no per-hook query strings or polling).
const queryCache = new Map<string, MediaQueryList>();

const getQuery = (query: string): MediaQueryList => {
    let mql = queryCache.get(query);
    if (!mql) {
        mql = window.matchMedia(query);
        queryCache.set(query, mql);
    }
    return mql;
};

const subscribe = (query: string, callback: () => void) => {
    const mql = getQuery(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
};

/**
 * Subscribe to a CSS media query using the native matchMedia API.
 * The component re-renders only when the query's match state actually changes
 * (no resize listeners, no polling).
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onStoreChange) => subscribe(query, onStoreChange),
        () => getQuery(query).matches,
        () => false,
    );
}