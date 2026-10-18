/**
 * Workspace account sync.
 *
 * The workspace is a single active file tree per account (the product model),
 * persisted through the backend's ownership-scoped project API. This hook:
 *
 *  1. reconciles once on sign-in / account switch:
 *       - restores the cloud tree when it is authoritative,
 *       - otherwise uploads the local tree (creating the first cloud project),
 *  2. debounces every subsequent tree mutation to the cloud,
 *  3. reports truthful status through the shared sync store.
 *
 * Conflict policy is deliberately conservative: a local tree with no persisted
 * record (legacy/pre-auth data) or a newer local `updatedAt`, or edits made
 * while the initial fetch was in flight, wins. A losing local tree is backed up
 * locally before a remote pull replaces it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../utils/mockFileSystem';
import { repairFileTree } from '../core/filesystem';
import type { WorkspaceRecord } from '../core/workspace/workspaceStorage';
import { loadCloudProjectId, saveCloudProjectId } from '../core/workspace/workspaceStorage';
import { getCurrentUserId } from '../utils/userStorage';
import {
    backupLocalWorkspace,
    createProject,
    deriveProjectName,
    getProject,
    hasTreeContent,
    listProjects,
    parseRemoteTimestamp,
    putProject,
    type RemoteProject,
} from '../core/sync/accountApi';
import { ApiError } from '../utils/apiClient';
import {
    beginAccountSync,
    cancelAccountSync,
    endAccountSync,
    registerAccountSyncRetry,
    useAccountSyncStatus,
} from '../core/sync/syncStatus';

const PUSH_DEBOUNCE_MS = 1200;

export interface WorkspaceCloudSync {
    phase: 'idle' | 'syncing' | 'synced' | 'error';
    lastSyncedAt: number | null;
    error: string | null;
    retry: () => void;
}

interface Params {
    userId: string | null;
    enabled: boolean;
    tree: FileNode[];
    record: WorkspaceRecord | null;
    hasProject: boolean;
    /** Local storage was corrupt/repaired to empty: never overwrite cloud with it. */
    preferRemote?: boolean;
    onRemoteWorkspace: (tree: FileNode[], updatedAt: number) => void;
}

function isNotFound(error: unknown): boolean {
    return error instanceof ApiError && error.status === 404;
}

export function useAccountWorkspaceSync({
    userId,
    enabled,
    tree,
    record,
    hasProject,
    preferRemote = false,
    onRemoteWorkspace,
}: Params): WorkspaceCloudSync {
    const status = useAccountSyncStatus();
    const [ready, setReady] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);

    const treeRef = useRef(tree);
    const recordRef = useRef(record);
    const hasProjectRef = useRef(hasProject);
    const onRemoteRef = useRef(onRemoteWorkspace);
    treeRef.current = tree;
    recordRef.current = record;
    hasProjectRef.current = hasProject;
    onRemoteRef.current = onRemoteWorkspace;

    const projectIdRef = useRef<string | null>(null);
    const lastSyncedTreeRef = useRef<string | null>(null);
    const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pushingRef = useRef(false);
    const pendingSnapshotRef = useRef<FileNode[] | null>(null);
    const preferRemoteRef = useRef(preferRemote);

    const retry = useCallback(() => {
        setRetryNonce((n) => n + 1);
    }, []);

    useEffect(() => registerAccountSyncRetry(retry), [retry]);

    const pushCurrentTree = useCallback(async (snapshot: FileNode[]) => {
        if (!userId || !enabled) return;
        if (getCurrentUserId() !== userId) return;
        if (!hasTreeContent(snapshot) && !recordRef.current) return;
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSyncedTreeRef.current) return;
        if (pushingRef.current) {
            // A write is in flight. Remember the newest tree and send it when
            // the current request finishes instead of silently dropping it.
            pendingSnapshotRef.current = snapshot;
            return;
        }

        pushingRef.current = true;
        beginAccountSync('workspace');
        try {
            let id = projectIdRef.current;
            if (id) {
                try {
                    await putProject(id, snapshot, deriveProjectName(snapshot));
                } catch (err) {
                    if (!isNotFound(err)) throw err;
                    if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                    // The project was removed elsewhere. Recreate it from the
                    // tree we still hold instead of dropping the user's work.
                    id = null;
                    projectIdRef.current = null;
                    saveCloudProjectId(null);
                }
            }
            if (!id) {
                const created = await createProject(snapshot, deriveProjectName(snapshot));
                if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                id = created.id;
                projectIdRef.current = id;
                saveCloudProjectId(id);
            }
            lastSyncedTreeRef.current = serialized;
            endAccountSync(undefined, 'workspace');
        } catch (err) {
            endAccountSync(err, 'workspace');
        } finally {
            pushingRef.current = false;
            const pending = pendingSnapshotRef.current;
            pendingSnapshotRef.current = null;
            if (pending && JSON.stringify(pending) !== lastSyncedTreeRef.current) {
                void pushCurrentTree(pending);
            }
        }
    }, [enabled, userId]);

    // Initial reconciliation. Runs on sign-in and on manual retry.
    useEffect(() => {
        if (!userId || !enabled) {
            projectIdRef.current = null;
            lastSyncedTreeRef.current = null;
            setReady(false);
            return;
        }

        let cancelled = false;
        setReady(false);
        beginAccountSync('workspace');

        const initialTree = treeRef.current;
        const initialTreeJson = JSON.stringify(initialTree);
        const initialRecordAt = recordRef.current?.updatedAt ?? 0;

        void (async () => {
            try {
                const projects = await listProjects();
                if (cancelled || getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }

                const storedId = loadCloudProjectId();
                let projectId: string | null = storedId && projects.some((p) => p.id === storedId)
                    ? storedId
                    : (projects[0]?.id ?? null);

                let remote: RemoteProject | null = null;
                if (projectId) {
                    try {
                        remote = await getProject(projectId);
                    } catch (err) {
                        if (!isNotFound(err)) throw err;
                        if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                        projectId = null;
                        saveCloudProjectId(null);
                    }
                }
                if (cancelled || getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }

                const localTree = treeRef.current;
                const localRecord = recordRef.current;
                const localAt = localRecord?.updatedAt ?? 0;
                const remoteAt = remote ? parseRemoteTimestamp(remote.updatedAt) : 0;
                const treeEditedDuringFetch = JSON.stringify(localTree) !== initialTreeJson;
                const recordEditedDuringFetch = (recordRef.current?.updatedAt ?? 0) > initialRecordAt;
                const localIsAuthoritative =
                    !preferRemoteRef.current && (
                        treeEditedDuringFetch ||
                        recordEditedDuringFetch ||
                        (hasTreeContent(localTree) && (!localRecord || !localAt)) ||
                        (localRecord !== null && localAt > remoteAt)
                    );

                if (remote) {
                    const remoteTree = repairFileTree(remote.tree).tree;
                    const legacyLocal = hasTreeContent(localTree) && (!localRecord || !localAt);
                    if (localIsAuthoritative) {
                        if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                        if (legacyLocal && hasTreeContent(remoteTree)) {
                            // Pre-sync local work with no identity/timestamp and a
                            // non-empty cloud workspace: preserve both. A new
                            // project avoids silently overwriting either side.
                            const created = await createProject(localTree, deriveProjectName(localTree));
                            if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                            projectIdRef.current = created.id;
                            saveCloudProjectId(created.id);
                        } else {
                            projectIdRef.current = remote.id;
                            saveCloudProjectId(remote.id);
                            await putProject(remote.id, localTree, deriveProjectName(localTree));
                        }
                        lastSyncedTreeRef.current = JSON.stringify(localTree);
                    } else {
                        if (hasTreeContent(localTree) && JSON.stringify(remoteTree) !== JSON.stringify(localTree)) {
                            backupLocalWorkspace(localTree, localRecord);
                        }
                        projectIdRef.current = remote.id;
                        saveCloudProjectId(remote.id);
                        lastSyncedTreeRef.current = JSON.stringify(remoteTree);
                        if (getCurrentUserId() === userId) {
                            onRemoteRef.current(remoteTree, remoteAt || Date.now());
                        }
                    }
                } else if (hasTreeContent(localTree)) {
                    const created = await createProject(localTree, deriveProjectName(localTree));
                    if (getCurrentUserId() !== userId) { cancelAccountSync('workspace'); return; }
                    projectIdRef.current = created.id;
                    saveCloudProjectId(created.id);
                    lastSyncedTreeRef.current = JSON.stringify(localTree);
                } else {
                    projectIdRef.current = null;
                    saveCloudProjectId(null);
                    lastSyncedTreeRef.current = JSON.stringify(localTree);
                }

                if (cancelled) { cancelAccountSync('workspace'); return; }
                preferRemoteRef.current = false;
                setReady(true);
                endAccountSync(undefined, 'workspace');
            } catch (err) {
                if (cancelled) { cancelAccountSync('workspace'); return; }
                // Keep the local workspace usable; the owner can retry from the
                // sync status row. No sync writes run until reconciliation succeeds.
                setReady(false);
                endAccountSync(err, 'workspace');
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, preferRemote, retryNonce, userId]);

    // Debounced push for every committed tree/record change after reconciliation.
    useEffect(() => {
        if (!userId || !enabled || !ready) return;
        if (!hasProject && !record) return;

        const serialized = JSON.stringify(tree);
        if (serialized === lastSyncedTreeRef.current) return;

        if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
        pushTimerRef.current = setTimeout(() => {
            pushTimerRef.current = null;
            void pushCurrentTree(treeRef.current);
        }, PUSH_DEBOUNCE_MS);

        return () => {
            if (pushTimerRef.current) {
                clearTimeout(pushTimerRef.current);
                pushTimerRef.current = null;
            }
        };
    }, [enabled, hasProject, pushCurrentTree, ready, record, tree, userId]);

    // Flush an in-flight debounce when the tab is hidden. Browsers may kill the
    // page without another tick; this keeps the last edit from being stranded.
    useEffect(() => {
        if (!ready) return;
        const flush = () => {
            if (pushTimerRef.current) {
                clearTimeout(pushTimerRef.current);
                pushTimerRef.current = null;
                void pushCurrentTree(treeRef.current);
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pushCurrentTree, ready]);

    return useMemo<WorkspaceCloudSync>(() => ({
        phase: status.phase,
        lastSyncedAt: status.lastSyncedAt,
        error: status.error,
        retry,
    }), [retry, status.error, status.lastSyncedAt, status.phase]);
}
