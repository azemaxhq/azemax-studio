/**
 * Storage Event Bus for Same-Window and Cross-Tab State Synchronization.
 *
 * Ensures all mounted components and windows reading from the same storage
 * keys stay in sync without requiring full reloads or polling.
 */

type KeySubscriber = (newValue: string | null) => void;

const subscribers = new Map<string, Set<KeySubscriber>>();
const allKeySubscribers = new Set<(key: string, newValue: string | null) => void>();

export function notifyStorageChange(key: string, value: string | null): void {
    const keySubs = subscribers.get(key);
    if (keySubs) {
        for (const sub of keySubs) {
            try { sub(value); } catch { /* ignore subscriber error */ }
        }
    }
    for (const sub of allKeySubscribers) {
        try { sub(key, value); } catch { /* ignore subscriber error */ }
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('azemax:storage:change', {
                detail: { key, value },
            }));
        } catch {
            /* ignore */
        }
    }
}

export function subscribeStorageKey(key: string, callback: KeySubscriber): () => void {
    if (!subscribers.has(key)) {
        subscribers.set(key, new Set());
    }
    const set = subscribers.get(key)!;
    set.add(callback);
    return () => {
        set.delete(callback);
        if (set.size === 0) subscribers.delete(key);
    };
}

export function subscribeAllStorageChanges(callback: (key: string, newValue: string | null) => void): () => void {
    allKeySubscribers.add(callback);
    return () => {
        allKeySubscribers.delete(callback);
    };
}

// Cross-tab storage event handler
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event: StorageEvent) => {
        if (!event.key) {
            // storage.clear() called in another tab
            for (const [, subs] of subscribers.entries()) {
                for (const sub of subs) {
                    try { sub(null); } catch { /* ignore */ }
                }
            }
            return;
        }
        notifyStorageChange(event.key, event.newValue);
    });
}
