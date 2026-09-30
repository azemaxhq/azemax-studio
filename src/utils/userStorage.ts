/**
 * Per-user localStorage namespacing.
 *
 * Once authentication exists, a shared browser profile must never leak one
 * user's workspace/chat cache into another user's session. All USER-DATA
 * keys are namespaced `azemax:u:<userId>:<base>`; pure UI prefs (panel
 * widths, tabs) stay global intentionally.
 *
 * Migration: on first namespaced read, the existing global/legacy value (if
 * any) is copied into the namespace exactly once, so current users lose no
 * local data when this ships.
 */

let currentUserId: string | null = null;
const migrated = new Set<string>();

export function setCurrentUserId(id: string | null): void {
    if (currentUserId !== id) {
        currentUserId = id;
        migrated.clear();
    }
}

export function getCurrentUserId(): string | null {
    return currentUserId;
}

export function namespacedKey(base: string): string {
    return currentUserId ? `azemax:u:${currentUserId}:${base}` : base;
}

function migrateOnce(base: string, fallbacks: string[]): void {
    if (!currentUserId || migrated.has(base)) return;
    migrated.add(base);
    const target = namespacedKey(base);
    try {
        if (localStorage.getItem(target) !== null) return;
        for (const fb of [base, ...fallbacks]) {
            const existing = localStorage.getItem(fb);
            if (existing !== null) {
                localStorage.setItem(target, existing);
                return;
            }
        }
    } catch {
        /* storage unavailable — callers already handle null */
    }
}

/** Namespaced read with global/legacy fallbacks (migrated on first hit). */
export function nsGetItem(base: string, fallbacks: string[] = []): string | null {
    if (!currentUserId) {
        try {
            return localStorage.getItem(base) ?? fallbacks.map((f) => { try { return localStorage.getItem(f); } catch { return null; } }).find((v) => v !== null) ?? null;
        } catch {
            return null;
        }
    }
    migrateOnce(base, fallbacks);
    try {
        return localStorage.getItem(namespacedKey(base));
    } catch {
        return null;
    }
}

/** Namespaced write. */
export function nsSetItem(base: string, value: string): void {
    try {
        localStorage.setItem(namespacedKey(base), value);
    } catch {
        /* quota errors are surfaced by callers that care */
        throw new Error('storage-quota');
    }
}

/** Namespaced remove. */
export function nsRemoveItem(base: string): void {
    try {
        localStorage.removeItem(namespacedKey(base));
    } catch {
        /* ignore */
    }
}
