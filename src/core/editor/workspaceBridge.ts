/**
 * Workspace Bridge — single factory for ExecutorDeps shared by every caller
 * (editor /// flow, chat panel, apply buttons). Reads the FRESHEST content at
 * each call: live file tree first, then the active Monaco model.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { getActiveEditorContext } from './activeEditorStore';
import type { ExecutorDeps } from '../ai/aiToolExecutor';

export interface WorkspaceBridgeActions {
    getFileTree: () => FileNode[];
    createFile: (path: string, content?: string) => { error?: unknown };
    deleteNode: (id: string) => void;
    renameNode: (id: string, newName: string) => { error?: unknown };
    updateFileContent: (fileId: string, content: string) => { error?: unknown };
}

const errText = (e: unknown): string | undefined =>
    e == null ? undefined : typeof e === 'string' ? e : (e as { message?: string }).message ?? String(e);

function findNodeByPath(nodes: FileNode[], target: string): FileNode | null {
    // Path-style resolution first (a/b/c), then plain name match
    if (target.includes('/')) {
        const parts = target.split('/').filter(Boolean);
        let current = nodes;
        let found: FileNode | null = null;
        for (const part of parts) {
            found = current.find(n => n.name === part) ?? null;
            if (!found) return null;
            current = found.children || [];
        }
        return found;
    }
    const byName = (list: FileNode[]): FileNode | null => {
        for (const n of list) {
            if (n.name === target) return n;
            if (n.children) {
                const f = byName(n.children);
                if (f) return f;
            }
        }
        return null;
    };
    return byName(nodes);
}

/**
 * Build the single authoritative ExecutorDeps for the current workspace state.
 * `activeFileName`/`activeFileId` pin the file the request originated from so
 * late writes still land on the right node even if selection changed.
 */
export function createExecutorDeps(
    actions: WorkspaceBridgeActions,
    activeFileName: string | null,
    activeFileId: string | null,
): ExecutorDeps {
    return {
        getFileContent: (path: string): string | null => {
            // Monaco-first for active file: the editor model is the source of truth
            // and is always fresher than the debounced ProjectContext tree.
            const ctx = getActiveEditorContext();
            if (ctx && path === ctx.fileName) return ctx.code;
            if (activeFileName && path === activeFileName && ctx) {
                // Fallback when ctx.fileName hasn't caught up yet but we pinned activeFileName
                const fresh = ctx.code;
                if (fresh != null) return fresh;
            }
            const node = findNodeByPath(actions.getFileTree(), path);
            if (node && typeof node.content === 'string') return node.content;
            return null;
        },
        getFileIdByPath: (path: string): string | null => {
            const node = findNodeByPath(actions.getFileTree(), path);
            if (node?.id) return node.id;
            const ctx = getActiveEditorContext();
            if (ctx && path === ctx.fileName) return ctx.fileId;
            if (path === activeFileName) return activeFileId;
            return null;
        },
        createFile: (path: string, content: string) => {
            const res = actions.createFile(path, content);
            return { success: !res.error, error: errText(res.error) };
        },
        deleteNode: (id: string) => actions.deleteNode(id),
        renameNode: (id: string, newName: string) => {
            const res = actions.renameNode(id, newName);
            return { success: !res.error, error: errText(res.error) };
        },
        updateFileContent: (fileId: string, content: string) => {
            const res = actions.updateFileContent(fileId, content);
            return { success: !res.error, error: errText(res.error) };
        },
        getActiveFilePath: () => getActiveEditorContext()?.fileName ?? activeFileName ?? null,
        getActiveFileId: () => getActiveEditorContext()?.fileId ?? activeFileId ?? null,
    };
}

/**
 * Capture an EditSnapshot for a file from the freshest available source
 * (Monaco first, tree fallback). Returns null when no content exists.
 */
export function captureSnapshot(
    filePath: string | null,
    monacoCode: string | null,
): import('../ai/editEngine').FileSnapshot | null {
    const content = monacoCode ?? (filePath ? getActiveEditorContext()?.code ?? null : null);
    if (!filePath || content === null) return null;
    return { filePath, content, lines: content.split('\n'), timestamp: Date.now() };
}
