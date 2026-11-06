/**
 * Centralized Storage Manager.
 *
 * Provides a unified, type-safe API for storage operations across the entire app.
 */
import type { z } from 'zod';
import { safeGetItem, safeRemoveItem, safeClearStorage } from './storageDriver';
import { debouncedLocalStorageSet, immediateLocalStorageSet, clearDebounceCache } from './storageDebounce';
import { notifyStorageChange, subscribeStorageKey } from './storageBus';
import { safeValidateWithSchema } from './storageSchema';

export interface StorageOptions {
    debounceMs?: number;
    immediate?: boolean;
}

export const StorageManager = {
    /**
     * Read and optionally validate a stored value.
     */
    get<T>(key: string, schema?: z.ZodType<T>, fallback?: T): T | null {
        const raw = safeGetItem(key);
        if (raw === null) {
            return fallback !== undefined ? fallback : null;
        }

        let parsed: unknown = raw;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // raw string if not JSON
            parsed = raw;
        }

        if (schema) {
            return safeValidateWithSchema(schema, parsed, fallback as T);
        }

        return parsed as T;
    },

    /**
     * Read a raw string value.
     */
    getRaw(key: string, fallback: string | null = null): string | null {
        const raw = safeGetItem(key);
        return raw !== null ? raw : fallback;
    },

    /**
     * Set a value (string or object) with optional debouncing.
     */
    set<T>(key: string, value: T, options?: StorageOptions): void {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (options?.immediate || options?.debounceMs === undefined) {
            if (options?.immediate) {
                immediateLocalStorageSet(key, serialized);
            } else {
                debouncedLocalStorageSet(key, serialized, 0);
            }
        } else {
            debouncedLocalStorageSet(key, serialized, options.debounceMs);
        }
    },

    /**
     * Remove a stored key and invalidate debounce cache.
     */
    remove(key: string): void {
        clearDebounceCache(key);
        safeRemoveItem(key);
        notifyStorageChange(key, null);
    },

    /**
     * Clear all storage and reset debounce caches.
     */
    clear(): void {
        clearDebounceCache();
        safeClearStorage();
        notifyStorageChange('', null);
    },

    /**
     * Subscribe to changes on a key.
     */
    subscribe(key: string, callback: (newValue: string | null) => void): () => void {
        return subscribeStorageKey(key, callback);
    },
};
