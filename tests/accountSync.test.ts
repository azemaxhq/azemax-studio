/**
 * Account-sync focused unit tests (pure helpers + per-user persistence).
 *
 * Run with: npm test
 */
import { check, finish, makeLocalStorage } from './_harness';
import type { FileNode } from '../src/utils/mockFileSystem';

const storage = makeLocalStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

const {
    loadChatsClearedAt,
    markChatsClearedAt,
    mergeSessions,
    sanitizeSessions,
} = await import('../src/utils/chatStorage');
const { deriveProjectName, hasTreeContent, parseRemoteTimestamp } = await import('../src/core/sync/accountApi');
const { setCurrentUserId, nsGetItem } = await import('../src/utils/userStorage');
const {
    loadWorkspaceRecord,
    saveWorkspaceRecord,
    WORKSPACE_RECORD_KEY,
} = await import('../src/core/workspace/workspaceStorage');
const {
    loadSettings,
    saveSettings,
    loadSettingsUpdatedAt,
    markSettingsUpdatedAt,
    withoutSettingsTimestamp,
    SETTINGS_STORAGE_KEY,
} = await import('../src/settings/settingsPersistence');
const { createDefaultSettings } = await import('../src/settings/settingsDefaults');
const { flushLocalStorage } = await import('../src/utils/localStorageDebounce');
const {
    beginAccountSync,
    cancelAccountSync,
    endAccountSync,
    getAccountSyncSnapshot,
    resetAccountSyncStatus,
    retryAccountSync,
    registerAccountSyncRetry,
} = await import('../src/core/sync/syncStatus');

const msg = (id: string, text: string, at: number) => ({ id, role: 'user' as const, text, timestamp: at });

// ---------------------------------------------------------------------------
// Chat merge — union, newest copy wins
// ---------------------------------------------------------------------------
{
    const local = [
        { id: 'a', title: 'Local A', createdAt: 1, updatedAt: 10, messages: [msg('m1', 'local', 10)] },
        { id: 'b', title: 'Local B', createdAt: 2, updatedAt: 20, messages: [msg('m2', 'local b', 20)] },
    ];
    const remote = [
        { id: 'a', title: 'Remote A', createdAt: 1, updatedAt: 30, messages: [msg('m3', 'remote', 30)] },
        { id: 'c', title: 'Remote C', createdAt: 3, updatedAt: 40, messages: [] },
    ];
    const merged = mergeSessions(local, remote);
    check('chat merge: unions ids across devices', merged.length === 3);
    check('chat merge: newest copy wins per id', merged.find((s) => s.id === 'a')?.title === 'Remote A');
    check('chat merge: sorted by newest activity', merged[0].id === 'c');
    check('chat merge: malformed input is ignored', sanitizeSessions({ nope: true }).length === 0);

    const afterDelete = mergeSessions(local, remote, [{ id: 'a', deletedAt: 35 }]);
    check('chat merge: a newer tombstone removes the session', !afterDelete.some((s) => s.id === 'a'));
    const resurrected = mergeSessions(local, remote, [{ id: 'a', deletedAt: 15 }]);
    check('chat merge: a session newer than its tombstone survives',
        resurrected.some((s) => s.id === 'a'));

    const afterClear = mergeSessions(local, remote, [], 35);
    check('chat merge: clear-all marker removes every older session',
        afterClear.length === 1 && afterClear[0].id === 'c');
    const newAfterClear = mergeSessions(
        [{ id: 'd', title: 'New', createdAt: 50, updatedAt: 50, messages: [] }],
        remote,
        [],
        35,
    );
    check('chat merge: a session created after the clear survives',
        newAfterClear.some((s) => s.id === 'd'));
}

// ---------------------------------------------------------------------------
// Workspace naming / content detection
// ---------------------------------------------------------------------------
{
    const oneRoot: FileNode[] = [{ id: 'f1', name: 'my-app', type: 'folder', parentId: null } as FileNode];
    const twoRoots: FileNode[] = [
        { id: 'f1', name: 'a', type: 'folder', parentId: null } as FileNode,
        { id: 'f2', name: 'b', type: 'folder', parentId: null } as FileNode,
    ];
    check('workspace: single root supplies the project name', deriveProjectName(oneRoot) === 'my-app');
    check('workspace: multiple roots use a neutral name', deriveProjectName(twoRoots) === 'Workspace');
    check('workspace: empty tree has no content', hasTreeContent([]) === false);
    check('workspace: root-only tree has no content', hasTreeContent([{ id: 'root' } as FileNode]) === false);
    check('workspace: real nodes count as content', hasTreeContent(oneRoot) === true);
    check('timestamp: invalid values become zero', parseRemoteTimestamp('not-a-date') === 0);
    check('timestamp: ISO values parse', parseRemoteTimestamp('2026-10-18T00:00:00.000Z') > 0);
}

// ---------------------------------------------------------------------------
// Per-user persistence isolation
// ---------------------------------------------------------------------------
{
    setCurrentUserId('user-a');
    saveWorkspaceRecord({ id: 'ws-a', createdAt: 100, updatedAt: 200, origin: 'blank' });
    const a = loadWorkspaceRecord();
    check('workspace record: persisted for user A', a?.id === 'ws-a' && a?.updatedAt === 200);

    setCurrentUserId('user-b');
    check('workspace record: user B cannot see user A record', loadWorkspaceRecord() === null);

    setCurrentUserId('user-a');
    check('workspace record: user A record returns after switch',
        loadWorkspaceRecord()?.id === 'ws-a');

    const aKey = `azemax:u:user-a:${WORKSPACE_RECORD_KEY}`;
    check('workspace record: storage key is namespaced', storage.getItem(aKey) !== null);

    check('chat clear marker: recorded for user A', markChatsClearedAt(5_000) === 5_000);
    check('chat clear marker: never moves backwards', markChatsClearedAt(4_000) === 5_000);
    setCurrentUserId('user-b');
    check('chat clear marker: isolated per account', loadChatsClearedAt() === 0);
    setCurrentUserId('user-a');
}

// ---------------------------------------------------------------------------
// Legacy global data is claimed by the first account only
// ---------------------------------------------------------------------------
{
    const firstBase = 'azemax-legacy-probe-first';
    storage.setItem(firstBase, 'first-value');
    setCurrentUserId('user-a');
    check('legacy migration: first account claims pre-auth data',
        nsGetItem(firstBase) === 'first-value');
    check('legacy migration: global source is removed after claim',
        storage.getItem(firstBase) === null);
    setCurrentUserId('user-b');
    check('legacy migration: later account cannot read claimed data',
        nsGetItem(firstBase) === null);

    const secondBase = 'azemax-legacy-probe-second';
    storage.setItem(secondBase, 'second-value');
    check('legacy migration: non-owner cannot claim unread pre-auth data',
        nsGetItem(secondBase) === null);
    check('legacy migration: non-owner leaves the global source untouched',
        storage.getItem(secondBase) === 'second-value');
    setCurrentUserId('user-a');
    check('legacy migration: owner can claim the remaining pre-auth data',
        nsGetItem(secondBase) === 'second-value');
}

// ---------------------------------------------------------------------------
// Settings persistence isolation + timestamp
// ---------------------------------------------------------------------------
{
    setCurrentUserId('user-a');
    const settings = createDefaultSettings();
    settings.general.theme = 'light';
    saveSettings(settings);
    flushLocalStorage();
    check('settings: saved under user A namespace',
        storage.getItem(`azemax:u:user-a:${SETTINGS_STORAGE_KEY}`) !== null);
    check('settings: updated-at marker advances', loadSettingsUpdatedAt() > 0);

    setCurrentUserId('user-b');
    const b = loadSettings();
    check('settings: user B gets defaults, not user A theme', b.general.theme === 'dark');

    setCurrentUserId('user-a');
    const a = loadSettings();
    check('settings: user A theme restored', a.general.theme === 'light');

    markSettingsUpdatedAt(12_345);
    check('settings: explicit timestamp is readable', loadSettingsUpdatedAt() === 12_345);

    // Hydrating a remote copy must not re-stamp the document as a local edit;
    // otherwise a stale device could win the next last-writer-wins comparison.
    const hydrated = loadSettings();
    hydrated.general.theme = 'dark';
    withoutSettingsTimestamp(() => saveSettings(hydrated));
    flushLocalStorage();
    check('settings: suppressed write persists the document',
        loadSettings().general.theme === 'dark');
    check('settings: suppressed write preserves the server timestamp',
        loadSettingsUpdatedAt() === 12_345);

    // Normal local edits still advance the timestamp.
    saveSettings(hydrated);
    check('settings: normal write advances the timestamp',
        loadSettingsUpdatedAt() !== 12_345);
}

// ---------------------------------------------------------------------------
// Sync status store — multiple sections settle together
// ---------------------------------------------------------------------------
{
    resetAccountSyncStatus();
    beginAccountSync();
    beginAccountSync();
    check('sync status: concurrent operations report syncing', getAccountSyncSnapshot().phase === 'syncing');
    endAccountSync();
    check('sync status: still syncing while one remains', getAccountSyncSnapshot().phase === 'syncing');
    endAccountSync();
    check('sync status: settles to synced with a timestamp',
        getAccountSyncSnapshot().phase === 'synced' && getAccountSyncSnapshot().lastSyncedAt !== null);

    beginAccountSync();
    endAccountSync(new Error('network down'));
    check('sync status: failure is surfaced', getAccountSyncSnapshot().phase === 'error'
        && getAccountSyncSnapshot().error === 'network down');

    resetAccountSyncStatus();
    beginAccountSync('workspace');
    beginAccountSync('settings');
    endAccountSync(new Error('workspace failed'), 'workspace');
    endAccountSync(undefined, 'settings');
    check('sync status: one section success cannot hide another failure',
        getAccountSyncSnapshot().phase === 'error'
        && getAccountSyncSnapshot().error === 'workspace failed');
    beginAccountSync('workspace');
    endAccountSync(undefined, 'workspace');
    check('sync status: a successful section retry clears its error',
        getAccountSyncSnapshot().phase === 'synced'
        && getAccountSyncSnapshot().error === null);

    // A stale request settling after a newer success must not downgrade the
    // truthful "synced" state (retries/account switches cancel old requests).
    cancelAccountSync('workspace');
    check('sync status: stale cancellation preserves a completed sync',
        getAccountSyncSnapshot().phase === 'synced');

    let retried = 0;
    const unregister = registerAccountSyncRetry(() => { retried++; });
    retryAccountSync();
    unregister();
    check('sync status: registered sections can be retried', retried === 1);
}

finish('accountSync');
