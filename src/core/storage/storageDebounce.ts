/**
 * Coalesced & Debounced LocalStorage writes.
 *
 * Prevents main thread blocking from rapid state changes while guaranteeing:
 * 1. Zero data loss on pagehide, visibilitychange, and beforeunload.
 * 2. Same-value write suppression with cache invalidation on remove/clear.
 * 3. Quota resilience via safeSetItem eviction hooks.
 * 4. Cross-component reactive change notification via storageBus.
 */

import { safeSetItem } from './storageDriver';
import { notifyStorageChange } from './storageBus';

const pending = new Map<string, string>();
const lastWritten = new Map<string, string>();
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let idleHandle: number | ReturnType<typeof setTimeout> | null = null;

const writePending = (): void => {
    timer = null;
    idleHandle = null;

    // Take snapshot of keys to write to avoid mutation during iteration
    const keysToWrite = [...queue];
    queue.length = 0;

    for (const key of keysToWrite) {
        const value = pending.get(key);
        if (value !== undefined) {
            pending.delete(key);
            if (value !== lastWritten.get(key)) {
                try {
                    const success = safeSetItem(key, value);
                    if (success) {
                        lastWritten.set(key, value);
                        notifyStorageChange(key, value);
                    }
                } catch {
                    // Ignore quota / storage errors
                }
            }
        }
    }
};

export const flushLocalStorage = (): void => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (typeof idleHandle === 'number' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleHandle);
    } else if (idleHandle) {
        clearTimeout(idleHandle);
    }
    idleHandle = null;
    writePending();
};

const scheduleWrite = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        if (typeof requestIdleCallback === 'function') {
            idleHandle = requestIdleCallback(writePending, { timeout: 100 });
        } else {
            idleHandle = setTimeout(writePending, 0);
        }
    }, 0);
};

/**
 * Queue a key for coalesced write.
 * @param key LocalStorage key
 * @param value Serialized string value
 * @param delay Optional debounce delay (ms)
 */
export const debouncedLocalStorageSet = (key: string, value: string, delay = 0): void => {
    if (!pending.has(key)) {
        queue.push(key);
    }
    pending.set(key, value);

    if (delay === 0) {
        // Fast schedule
        if (!timer && !idleHandle) {
            scheduleWrite();
        }
    } else {
        if (timer) clearTimeout(timer);
        timer = setTimeout(scheduleWrite, delay);
    }
};

/**
 * Invalidate the write suppression cache for a key or all keys.
 * Must be called when removing or resetting keys so subsequent writes of
 * identical values are not mistakenly skipped.
 */
export const clearDebounceCache = (key?: string): void => {
    if (key) {
        lastWritten.delete(key);
        pending.delete(key);
        const idx = queue.indexOf(key);
        if (idx !== -1) queue.splice(idx, 1);
    } else {
        lastWritten.clear();
        pending.clear();
        queue.length = 0;
    }
};

/**
 * Direct synchronous write bypassing debounce but updating cache and bus.
 */
export const immediateLocalStorageSet = (key: string, value: string): boolean => {
    pending.delete(key);
    const idx = queue.indexOf(key);
    if (idx !== -1) queue.splice(idx, 1);

    try {
        const success = safeSetItem(key, value);
        if (success) {
            lastWritten.set(key, value);
            notifyStorageChange(key, value);
        }
        return success;
    } catch {
        return false;
    }
};

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushLocalStorage);
    window.addEventListener('pagehide', flushLocalStorage);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushLocalStorage();
    });
}

