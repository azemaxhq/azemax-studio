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
let generation = 0;
const migrated = new Set<string>();

// Legacy (pre-auth) values are global localStorage keys. They belong to the
// FIRST account that signs in on this browser; otherwise every later account
// would inherit the previous user's old workspace/settings/chats. The marker is
// written once and intentionally survives sign-out.
const LEGACY_OWNER_KEY = 'azemax:legacy-owner';
let legacyOwner: string | null | undefined;

const readLegacyOwner = (): string | null => {
    if (legacyOwner !== undefined) return legacyOwner;
    try {
        legacyOwner = localStorage.getItem(LEGACY_OWNER_KEY);
    } catch {
        legacyOwner = null;
    }
    return legacyOwner;
};

export function setCurrentUserId(id: string | null): void {
    if (currentUserId !== id) {
        currentUserId = id;
        migrated.clear();
        if (id && !readLegacyOwner()) {
            try {
                localStorage.setItem(LEGACY_OWNER_KEY, id);
                legacyOwner = id;
            } catch {
                legacyOwner = null;
            }
        }
        // Bumped on every account transition. Consumers that cache data during
        // module initialization (workspace boot load, settings) use this to
        // invalidate their cache when the signed-in account changes.
        generation++;
    }
}

export function getCurrentUserId(): string | null {
    return currentUserId;
}

/** Monotonic account-session generation (never persisted). */
export function getStorageGeneration(): number {
    return generation;
}

export function namespacedKey(base: string): string {
    return currentUserId ? `azemax:u:${currentUserId}:${base}` : base;
}

function migrateOnce(base: string, fallbacks: string[]): void {
    if (!currentUserId || migrated.has(base)) return;
    migrated.add(base);

    // Only the first account on this browser may claim pre-auth global data.
    // If another account owns it, return without touching either namespace.
    const owner = readLegacyOwner();
    if (owner && owner !== currentUserId) return;

    const target = namespacedKey(base);
    try {
        let hasTarget = localStorage.getItem(target) !== null;
        for (const source of [base, ...fallbacks]) {
            const existing = localStorage.getItem(source);
            if (existing === null) continue;
            if (!hasTarget) {
                localStorage.setItem(target, existing);
                hasTarget = true;
            }
            // Remove the global copy once claimed so a later account cannot
            // read it through a code path that bypasses the owner check.
            localStorage.removeItem(source);
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
