/**
 * Workspace Bridge — single factory for ExecutorDeps shared by every caller
 * (editor /// flow, chat panel, apply buttons). Reads the FRESHEST content at
 * each call: live file tree first, then the active Monaco model.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { getActiveEditorContext, getActiveEditor } from './activeEditorStore';
import type { ExecutorDeps } from '../ai/aiToolExecutor';
import { resolvePath, pathOf, findNodeById } from '../../utils/safeTree';

export interface WorkspaceBridgeActions {
    getFileTree: () => FileNode[];
    createFile: (path: string, content?: string) => { error?: unknown };
    deleteNode: (id: string) => void;
    renameNode: (id: string, newName: string) => { error?: unknown };
    updateFileContent: (fileId: string, content: string) => { error?: unknown };
}

const errText = (e: unknown): string | undefined =>
    e == null ? undefined : typeof e === 'string' ? e : (e as { message?: string }).message ?? String(e);

export function findNodeByPath(nodes: FileNode[], target: string): FileNode | null {
    try {
        const byResolve = resolvePath(nodes as any, target);
        if (byResolve && byResolve.id !== 'root') return byResolve;
    } catch { /* ignore */ }
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

function resolveFullPath(nodes: FileNode[], id: string | null): string | null {
    if (!id) return null;
    try {
        const p = pathOf(nodes as any, id);
        return p || null;
    } catch { return null; }
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
        getFileTree: actions.getFileTree,
        getFileContent: (path: string): string | null => {
            // Monaco-first for active file: the editor model is the source of truth
            // Prefer ID-based match so duplicate bare names in different folders don't collide
            const ctx = getActiveEditorContext();
            if (ctx) {
                // Exact filePath match (full path)
                if (path === ctx.filePath) return ctx.code;
                // Bare name match only when pinned ID matches active ID (same document)
                if (path === ctx.fileName) {
                    // If tree has two files named hello.java, ensure we only shortcut when path resolves to activeId
                    const node = findNodeByPath(actions.getFileTree(), path);
                    if (!node || node.id === ctx.fileId) return ctx.code;
                    // Otherwise it's a different file with same name — fall through to tree lookup
                }
                if (activeFileName && path === activeFileName && ctx.fileId === activeFileId) {
                    const fresh = ctx.code;
                    if (fresh != null) return fresh;
                }
            } else if (activeFileName && path === activeFileName) {
                // Store not yet ready but we have pinned file — try to find node then check activeId mapping
                const maybeCtx = ctx;
                void maybeCtx;
            }
            const node = findNodeByPath(actions.getFileTree(), path);
            if (node && typeof node.content === 'string') return node.content;
            return null;
        },
        getFileIdByPath: (path: string): string | null => {
            const node = findNodeByPath(actions.getFileTree(), path);
            if (node?.id) return node.id;
            const ctx = getActiveEditorContext();
            if (ctx && (path === ctx.filePath || path === ctx.fileName)) return ctx.fileId;
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
            // Pre-validate Java class/file consistency before writing
            // Soft path: validate Java file vs class name via static import (avoid require cycle)
            // Validation is also run deterministically in editEngine.buildCandidates; this is a second guard for direct updateFileContent calls
            try {
                const tree = actions.getFileTree();
                const node = findNodeById(tree as any, fileId) as FileNode | null;
                const targetName = (node?.name ?? activeFileName ?? '') as string;
                const ext = targetName.split('.').pop()?.toLowerCase() ?? '';
                if (ext === 'java' && content) {
                    const expected = targetName.replace(/\.java$/i, '');
                    const candPub = content.match(/\bpublic\s+(?:(?:final|abstract|sealed)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_][A-Za-z0-9_]*)/);
                    const candType = candPub?.[1] ?? null;
                    if (candType && candType !== expected) {
                        const candCount = (content.match(/\bpublic\s+(?:(?:final|abstract|sealed)\s+)*(?:class|interface|enum|record|@interface)\s+/g) || []).length;
                        if (candCount === 1) {
                            content = content.replace(new RegExp(`(\\bpublic\\s+(?:(?:final|abstract|sealed)\\s+)*(?:class|interface|enum|record|@interface)\\s+)${candType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), `$1${expected}`);
                        }
                    }
                }
            } catch { /* best-effort validation */ }
            const res = actions.updateFileContent(fileId, content);
            // Sync Monaco immediately for active file so verification reads fresh candidate (fileTree update is async via React state)
            try {
                const editor = getActiveEditor();
                const ctx = getActiveEditorContext();
                const activeId = ctx?.fileId ?? activeFileId;
                const activePath = ctx?.filePath ?? ctx?.fileName ?? activeFileName;
                if (editor && activeId === fileId) {
                    const model = editor.getModel();
                    if (model && !model.isDisposed() && model.getValue() !== content) {
                        editor.pushUndoStop();
                        const fullRange = model.getFullModelRange();
                        editor.executeEdits('agent-apply', [{ range: fullRange, text: content, forceMoveMarkers: true }]);
                        editor.pushUndoStop();
                    }
                } else if (editor && activePath) {
                    const fileNode = findNodeByPath(actions.getFileTree(), activePath);
                    if (fileNode?.id === fileId) {
                        const model = editor.getModel();
                        if (model && !model.isDisposed() && model.getValue() !== content) {
                            editor.pushUndoStop();
                            editor.executeEdits('agent-apply', [{ range: model.getFullModelRange(), text: content, forceMoveMarkers: true }]);
                            editor.pushUndoStop();
                        }
                    }
                }
                // Also handle rename case where fileId's path changed
                if (editor && resolveFullPath(actions.getFileTree(), fileId) && getActiveEditorContext()?.fileId === fileId) {
                    const model = editor.getModel();
                    if (model && !model.isDisposed() && model.getValue() !== content) {
                        editor.pushUndoStop();
                        editor.executeEdits('agent-apply-rename', [{ range: model.getFullModelRange(), text: content, forceMoveMarkers: true }]);
                        editor.pushUndoStop();
                    }
                }
            } catch {
                // best-effort: fileTree already updated, Monaco sync is optional
            }
            return { success: !res.error, error: errText(res.error) };
        },
        getActiveFilePath: () => getActiveEditorContext()?.filePath ?? getActiveEditorContext()?.fileName ?? activeFileName ?? null,
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
