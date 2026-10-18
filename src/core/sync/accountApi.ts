/**
 * Thin, typed account-sync API.
 *
 * All calls go through `apiFetch`, which attaches the Firebase ID token as a
 * Bearer credential; the server derives ownership from that verified identity.
 * The client never sends a userId or owner.
 */
import { apiFetch } from '../../utils/apiClient';
import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { nsSetItem } from '../../utils/userStorage';
import { WORKSPACE_SYNC_BACKUP_KEY, type WorkspaceRecord } from '../workspace/workspaceStorage';

export type AccountSection = 'settings' | 'chats';

export interface AccountSectionValue<T = unknown> {
    data: T | null;
    updatedAt: string | null;
}

export interface ProjectSummary {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface RemoteProject extends ProjectSummary {
    tree: FileNode[];
}

export function hasTreeContent(tree: FileNode[]): boolean {
    return Array.isArray(tree) && tree.some((node) => node && node.id !== ROOT_NODE_ID);
}

/** Mirror ProjectContext's single-root naming rule for a stable cloud name. */
export function deriveProjectName(tree: FileNode[]): string {
    const roots = Array.isArray(tree) ? tree.filter((node) => node && node.id !== ROOT_NODE_ID) : [];
    if (roots.length === 1 && typeof roots[0].name === 'string' && roots[0].name.trim()) {
        return roots[0].name.trim().slice(0, 200);
    }
    return 'Workspace';
}

export function parseRemoteTimestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export async function listProjects(): Promise<ProjectSummary[]> {
    const result = await apiFetch<{ projects?: ProjectSummary[] }>('/projects');
    return Array.isArray(result.projects) ? result.projects : [];
}

export async function getProject(id: string): Promise<RemoteProject> {
    return apiFetch<RemoteProject>(`/projects/${encodeURIComponent(id)}`);
}

export async function createProject(tree: FileNode[], name = deriveProjectName(tree)): Promise<RemoteProject> {
    return apiFetch<RemoteProject>('/projects', {
        method: 'POST',
        body: JSON.stringify({ name, tree }),
    });
}

export async function putProject(id: string, tree: FileNode[], name = deriveProjectName(tree)): Promise<RemoteProject> {
    return apiFetch<RemoteProject>(`/projects/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, tree }),
    });
}

export async function fetchAccountSection<T>(section: AccountSection): Promise<AccountSectionValue<T>> {
    const result = await apiFetch<{ data?: T | null; updatedAt?: string | null }>(
        `/account/state/${section}`,
    );
    return {
        data: result.data === undefined ? null : result.data,
        updatedAt: result.updatedAt ?? null,
    };
}

export async function putAccountSection<T>(section: AccountSection, data: T): Promise<AccountSectionValue<T>> {
    const result = await apiFetch<{ data?: T; updatedAt?: string }>(
        `/account/state/${section}`,
        {
            method: 'PUT',
            body: JSON.stringify({ data }),
        },
    );
    return { data: result.data ?? data, updatedAt: result.updatedAt ?? null };
}

export async function deleteAccountSection(section: AccountSection): Promise<void> {
    await apiFetch(`/account/state/${section}`, { method: 'DELETE' });
}

/**
 * Preserve the losing local workspace before a remote pull replaces it. This is
 * deliberately local-only and per-account: a failed merge must never silently
 * destroy work just because another device wrote later.
 */
export function backupLocalWorkspace(tree: FileNode[], record: WorkspaceRecord | null): void {
    try {
        nsSetItem(WORKSPACE_SYNC_BACKUP_KEY, JSON.stringify({
            tree,
            record,
            savedAt: new Date().toISOString(),
        }));
    } catch {
        /* best-effort; sync itself must not fail because a backup could not be written */
    }
}
