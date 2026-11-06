/**
 * Safe Storage Driver with in-memory fallback and quota management.
 *
 * Guarantees:
 * 1. Never throws on restricted or unavailable storage (e.g. Node 22, SSR, Safari private mode, SecurityError).
 * 2. Recovers automatically from QuotaExceededError via registered eviction handlers.
 * 3. Provides clean typed operations with safe JSON serialization/deserialization.
 */

export class StorageQuotaError extends Error {
    constructor(message = 'Storage quota exceeded') {
        super(message);
        this.name = 'StorageQuotaError';
    }
}

export class MemoryStorage implements Storage {
    private store = new Map<string, string>();

    get length(): number {
        return this.store.size;
    }

    clear(): void {
        this.store.clear();
    }

    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }

    key(index: number): string | null {
        return Array.from(this.store.keys())[index] ?? null;
    }

    removeItem(key: string): void {
        this.store.delete(key);
    }

    setItem(key: string, value: string): void {
        this.store.set(key, String(value));
    }

    _dump(): Record<string, string> {
        return Object.fromEntries(this.store.entries());
    }
}

type EvictionHandler = () => boolean; // returns true if space was freed
const evictionHandlers = new Set<EvictionHandler>();
const quotaListeners = new Set<(key: string) => void>();

export function registerQuotaEvictionHandler(handler: EvictionHandler): () => void {
    evictionHandlers.add(handler);
    return () => evictionHandlers.delete(handler);
}

export function subscribeToQuotaExceeded(listener: (key: string) => void): () => void {
    quotaListeners.add(listener);
    return () => quotaListeners.delete(listener);
}

export function isQuotaExceededError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; code?: number; number?: number; message?: string };
    return (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22 ||
        e.code === 1014 ||
        e.number === -2147024882 ||
        (typeof e.message === 'string' && /quota/i.test(e.message))
    );
}

let probedStorage: Storage | null = null;
let isUsingMemoryFallback = false;

function probeStorage(): Storage {
    if (probedStorage) return probedStorage;

    try {
        if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
            const ls = globalThis.localStorage;
            if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
                const testKey = '__azemax_storage_probe__';
                ls.setItem(testKey, '1');
                ls.removeItem(testKey);
                probedStorage = ls;
                isUsingMemoryFallback = false;
                return probedStorage;
            }
        }
    } catch {
        // Restricted, disabled, or Node without --localstorage-file
    }

    probedStorage = new MemoryStorage();
    isUsingMemoryFallback = true;
    return probedStorage;
}

/** Reset probed storage (used in test isolation when localStorage mock is swapped). */
export function resetStorageProbe(): void {
    probedStorage = null;
    isUsingMemoryFallback = false;
}

export function getRawStorage(): Storage {
    return probeStorage();
}

export function isMemoryFallbackActive(): boolean {
    probeStorage();
    return isUsingMemoryFallback;
}

/**
 * Safe getItem wrapper that never throws.
 */
export function safeGetItem(key: string): string | null {
    try {
        const storage = getRawStorage();
        return storage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Safe setItem wrapper with quota eviction and automatic retry.
 */
export function safeSetItem(key: string, value: string): boolean {
    const storage = getRawStorage();
    try {
        storage.setItem(key, value);
        return true;
    } catch (err) {
        if (isQuotaExceededError(err)) {
            // Attempt eviction of disposable caches (alerts, history, old tombstones)
            let freed = false;
            for (const handler of evictionHandlers) {
                try {
                    if (handler()) freed = true;
                } catch {
                    /* ignore handler error */
                }
            }

            if (freed) {
                // Retry write once after eviction
                try {
                    storage.setItem(key, value);
                    return true;
                } catch (retryErr) {
                    if (!isQuotaExceededError(retryErr)) {
                        return false;
                    }
                }
            }

            for (const listener of quotaListeners) {
                try { listener(key); } catch { /* ignore */ }
            }
            throw new StorageQuotaError(`Failed to save "${key}" - storage quota exceeded.`);
        }
        return false;
    }
}

/**
 * Safe removeItem wrapper that never throws.
 */
export function safeRemoveItem(key: string): void {
    try {
        const storage = getRawStorage();
        storage.removeItem(key);
    } catch {
        /* ignore */
    }
}

/**
 * Safe clear wrapper that never throws.
 */
export function safeClearStorage(): void {
    try {
        const storage = getRawStorage();
        storage.clear();
    } catch {
        /* ignore */
    }
}

/**
 * Safe JSON parser with fallback.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
    if (raw == null || raw === '') return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

/**
 * Safe JSON stringify that returns null on circular or error.
 */
export function safeJsonStringify(data: unknown): string | null {
    try {
        return JSON.stringify(data);
    } catch {
        return null;
    }
}

