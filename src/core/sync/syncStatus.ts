/**
 * Account-sync status — a tiny external store so every surface (settings,
 * status bar, account menu) can render the SAME truthful state without a
 * provider tree dependency.
 *
 * Multiple sections sync independently (workspace, settings, chats). Errors are
 * tracked per section so a successful write in one section cannot hide a
 * failure in another. The store counts in-flight operations and reports
 * "syncing" until all settle; the phase stays "error" while any section has an
 * unresolved failure.
 */
import { useSyncExternalStore } from 'react';

export type AccountSyncPhase = 'idle' | 'syncing' | 'synced' | 'error';

export interface AccountSyncSnapshot {
    phase: AccountSyncPhase;
    pending: number;
    lastSyncedAt: number | null;
    error: string | null;
}

const DEFAULT_SECTION = 'default';

let snapshot: AccountSyncSnapshot = {
    phase: 'idle',
    pending: 0,
    lastSyncedAt: null,
    error: null,
};

/** Unresolved failure per sync section (workspace/settings/chats). */
const sectionErrors = new Map<string, string>();

const listeners = new Set<() => void>();
const retryHandlers = new Set<() => void>();

const emit = () => {
    for (const listener of listeners) listener();
};

const setSnapshot = (next: Partial<AccountSyncSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    emit();
};

function firstSectionError(): string | null {
    for (const message of sectionErrors.values()) return message;
    return null;
}

function messageFor(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'Sync failed');
}

export function beginAccountSync(section: string = DEFAULT_SECTION): void {
    // Starting a section is a retry of that section: clear its previous error,
    // but never another section's unresolved failure.
    sectionErrors.delete(section);
    const pending = snapshot.pending + 1;
    setSnapshot({ pending, phase: 'syncing', error: firstSectionError() });
}

export function endAccountSync(error?: unknown, section: string = DEFAULT_SECTION): void {
    const pending = Math.max(0, snapshot.pending - 1);
    if (error) {
        const message = messageFor(error);
        sectionErrors.set(section, message);
        setSnapshot({ pending, phase: 'error', error: message });
        return;
    }
    sectionErrors.delete(section);
    const remainingError = firstSectionError();
    if (pending === 0) {
        if (remainingError) {
            setSnapshot({ pending, phase: 'error', error: remainingError });
        } else {
            setSnapshot({ pending, phase: 'synced', lastSyncedAt: Date.now(), error: null });
        }
    } else {
        setSnapshot({ pending, phase: 'syncing', error: remainingError });
    }
}

/**
 * Settle a stale/cancelled operation without pretending it succeeded.
 *
 * Retries and account switches can leave an older request in flight. That
 * request must release its pending slot, but a late completion must never
 * clear the newer request's error or downgrade a completed sync.
 */
export function cancelAccountSync(_section: string = DEFAULT_SECTION): void {
    const pending = Math.max(0, snapshot.pending - 1);
    const error = firstSectionError();
    if (error) {
        setSnapshot({ pending, phase: 'error', error });
        return;
    }
    if (pending === 0 && snapshot.phase === 'syncing') {
        setSnapshot({ pending, phase: 'idle', error: null });
        return;
    }
    setSnapshot({ pending, error: null });
}

/** Report a failure that did not come from a tracked request (e.g. bootstrap). */
export function reportAccountSyncError(error: unknown, section: string = DEFAULT_SECTION): void {
    const message = messageFor(error);
    sectionErrors.set(section, message);
    setSnapshot({ pending: snapshot.pending, phase: 'error', error: message });
}

export function resetAccountSyncStatus(): void {
    sectionErrors.clear();
    setSnapshot({ phase: 'idle', pending: 0, lastSyncedAt: null, error: null });
}

/** Hooks register a retry action so UI surfaces can recover all sections. */
export function registerAccountSyncRetry(handler: () => void): () => void {
    retryHandlers.add(handler);
    return () => retryHandlers.delete(handler);
}

export function retryAccountSync(): void {
    for (const handler of Array.from(retryHandlers)) {
        try {
            handler();
        } catch {
            /* one section failing must not prevent the others retrying */
        }
    }
}

export function getAccountSyncSnapshot(): AccountSyncSnapshot {
    return snapshot;
}

export function subscribeAccountSync(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useAccountSyncStatus(): AccountSyncSnapshot {
    return useSyncExternalStore(
        subscribeAccountSync,
        getAccountSyncSnapshot,
        getAccountSyncSnapshot,
    );
}
