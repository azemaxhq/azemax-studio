/**
 * Workspace persistence primitives shared by the runtime ProjectContext and
 * the account-sync layer.
 *
 * Keeping the key names and the workspace record schema in one module prevents
 * the sync service and the UI from disagreeing about what "the current
 * workspace" means. Values remain per-user through userStorage's namespace.
 */
import { nsGetItem, nsSetItem, nsRemoveItem } from '../../utils/userStorage';
import type { WorkspaceOrigin } from './workspaceModel';

export const FILE_TREE_KEY = 'azemax-file-tree';
export const LEGACY_FILE_TREE_KEY = 'deepcontext-file-tree';
export const WORKSPACE_RECORD_KEY = 'azemax-workspace-record';
export const LEGACY_WORKSPACE_RECORD_KEY = 'deepcontext-workspace-record';
export const CLOUD_PROJECT_ID_KEY = 'azemax-cloud-project-id';
export const WORKSPACE_SYNC_BACKUP_KEY = 'azemax-workspace-sync-backup';

export interface WorkspaceRecord {
    id: string;
    createdAt: number;
    /** Last local or pulled mutation time (epoch ms). Used for sync conflict checks. */
    updatedAt?: number;
    origin: WorkspaceOrigin;
}

const VALID_ORIGINS = new Set<WorkspaceOrigin>(['blank', 'template', 'import', 'restored', 'unknown']);

export function loadWorkspaceRecord(): WorkspaceRecord | null {
    try {
        const saved = nsGetItem(WORKSPACE_RECORD_KEY, [LEGACY_WORKSPACE_RECORD_KEY]);
        if (!saved) return null;
        const parsed = JSON.parse(saved) as Partial<WorkspaceRecord>;
        if (typeof parsed.id === 'string' && parsed.id && typeof parsed.createdAt === 'number') {
            return {
                id: parsed.id,
                createdAt: parsed.createdAt,
                updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
                origin: VALID_ORIGINS.has(parsed.origin as WorkspaceOrigin)
                    ? (parsed.origin as WorkspaceOrigin)
                    : 'unknown',
            };
        }
    } catch {
        /* corrupt record is dropped; identity is re-created, data untouched */
    }
    return null;
}

export function saveWorkspaceRecord(record: WorkspaceRecord): void {
    try {
        nsSetItem(WORKSPACE_RECORD_KEY, JSON.stringify(record));
    } catch {
        /* best-effort */
    }
}

export function loadCloudProjectId(): string | null {
    try {
        return nsGetItem(CLOUD_PROJECT_ID_KEY);
    } catch {
        return null;
    }
}

export function saveCloudProjectId(id: string | null): void {
    try {
        if (id) nsSetItem(CLOUD_PROJECT_ID_KEY, id);
        else nsRemoveItem(CLOUD_PROJECT_ID_KEY);
    } catch {
        /* best-effort */
    }
}
