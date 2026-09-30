/**
 * Preview (shadow) workspace for the AI agent gate.
 *
 * Generate → diff → show → accept/reject → apply. The agent plans and
 * "applies" against an in-memory CLONE of the file tree; nothing touches the
 * real tree, the Monaco models, or React state until the user explicitly
 * accepts. Every proposed change records its before/after so Accept can
 * re-verify staleness (file changed since proposal → that change is refused).
 *
 * Pure in-memory: no Monaco coupling, no React state, no I/O.
 */
import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import {
    createFile as opCreateFile,
    createFolder as opCreateFolder,
    deleteNode as opDeleteNode,
    renameNode as opRenameNode,
    updateFileContent as opUpdateFileContent,
} from '../filesystem';
import { findNodeById, pathOf } from '../../utils/safeTree';
import { findNodeByPath } from './workspaceBridge';
import type { ExecutorDeps } from '../ai/aiToolExecutor';

export interface ProposedChange {
    kind: 'update' | 'create' | 'delete' | 'rename';
    /** Display path of the affected file. */
    path: string;
    /** File id in the base tree (null for creates). */
    fileId: string | null;
    /** Base-tree content (null for creates). */
    before: string | null;
    /** Proposed content (null for deletes). */
    after: string | null;
    /** Rename target path (rename only). */
    newPath?: string;
}

export interface PreviewWorkspace {
    /** ExecutorDeps over the shadow tree for executeActionPlan. */
    deps: ExecutorDeps;
    /** Current shadow tree (for reads/diffs). */
    getShadowTree: () => FileNode[];
    /** Ordered proposed changes (before/after captured). */
    getChanges: () => ProposedChange[];
}

function cloneTree(tree: FileNode[]): FileNode[] {
    return JSON.parse(JSON.stringify(tree)) as FileNode[];
}

function displayPath(tree: FileNode[], id: string, fallback: string): string {
    try {
        return pathOf(tree as never, id) || fallback;
    } catch {
        return fallback;
    }
}

export function createPreviewWorkspace(
    baseTree: FileNode[],
    pinned: { fileName: string | null; fileId: string | null },
): PreviewWorkspace {
    let shadow: FileNode[] = cloneTree(Array.isArray(baseTree) ? baseTree : []);
    // fileId -> { kind, before } — `before` is first-write-wins so Accept can
    // verify the real file still matches what the proposal was based on.
    const beforeMap = new Map<string, { kind: ProposedChange['kind']; before: string | null; path: string; newPath?: string }>();
    const createdPaths = new Map<string, string>(); // shadowId -> path
    const order: string[] = []; // change keys in application order

    const recordKey = (kind: string, idOrPath: string) => `${kind}:${idOrPath}`;

    const noteChange = (kind: ProposedChange['kind'], key: string, entry: { before: string | null; path: string; newPath?: string }) => {
        if (!beforeMap.has(key)) {
            beforeMap.set(key, { kind, ...entry });
            order.push(key);
        } else {
            const existing = beforeMap.get(key)!;
            if (entry.newPath) existing.newPath = entry.newPath;
        }
    };

    const splitParent = (target: string): { dir: string; name: string } => {
        const parts = String(target).split('/').filter(Boolean);
        const name = parts.pop() ?? target;
        return { dir: parts.join('/'), name };
    };

    const resolveDirId = (dir: string): string | null => {
        if (!dir) return ROOT_NODE_ID;
        const node = findNodeByPath(shadow, dir);
        return node && node.type === 'folder' ? node.id : null;
    };

    const deps: ExecutorDeps = {
        getFileTree: () => shadow,
        getFileContent: (path: string): string | null => {
            const node = findNodeByPath(shadow, path);
            return node && node.type === 'file' && typeof node.content === 'string' ? node.content : null;
        },
        getFileIdByPath: (path: string): string | null => {
            const node = findNodeByPath(shadow, path);
            return node ? node.id : null;
        },
        createFile: (path: string, content: string) => {
            const { dir, name } = splitParent(path);
            // Auto-create missing parent folders inside the shadow (mirrors
            // ensureFolderPath behaviour for template scaffolds).
            let parentId = resolveDirId(dir);
            if (!parentId && dir) {
                let acc = '';
                for (const part of dir.split('/').filter(Boolean)) {
                    acc = acc ? `${acc}/${part}` : part;
                    const existing = findNodeByPath(shadow, acc);
                    if (existing && existing.type === 'folder') continue;
                    const parentOfAcc = acc.includes('/') ? resolveDirId(acc.slice(0, acc.lastIndexOf('/'))) : ROOT_NODE_ID;
                    if (!parentOfAcc) return { success: false, error: `Preview: cannot create folder ${acc}` };
                    const r = opCreateFolder(shadow, { name: part, parentId: parentOfAcc });
                    if (r.error || !r.changed) return { success: false, error: 'Preview: cannot create folder' };
                    shadow = r.tree;
                }
                parentId = resolveDirId(dir);
            }
            if (!parentId) return { success: false, error: `Preview: parent folder not found for ${path}` };
            const r = opCreateFile(shadow, { name, parentId, content });
            if (r.error || !r.changed || !r.node) {
                const e = r.error as { message?: string } | undefined;
                return { success: false, error: typeof e === 'string' ? e : e?.message ?? 'Preview: create failed' };
            }
            shadow = r.tree;
            createdPaths.set(r.node.id, path);
            noteChange('create', recordKey('create', path), { before: null, path });
            return { success: true };
        },
        deleteNode: (id: string) => {
            const node = findNodeById(shadow as never, id) as FileNode | null;
            const before = node && node.type === 'file' && typeof node.content === 'string' ? node.content : null;
            const disp = node ? displayPath(shadow, id, node.name) : id;
            const r = opDeleteNode(shadow, id);
            if (!r.error && r.changed) {
                shadow = r.tree;
                noteChange('delete', recordKey('delete', id), { before, path: disp });
            }
        },
        renameNode: (id: string, newName: string) => {
            const node = findNodeById(shadow as never, id) as FileNode | null;
            const disp = node ? displayPath(shadow, id, node.name) : id;
            const before = node && node.type === 'file' && typeof node.content === 'string' ? node.content : null;
            const r = opRenameNode(shadow, id, newName);
            if (r.error) {
                const e = r.error as { message?: string } | string;
                return { success: false, error: typeof e === 'string' ? e : e?.message ?? 'Preview: rename failed' };
            }
            shadow = r.tree;
            const afterNode = findNodeById(shadow as never, id) as FileNode | null;
            const newDisp = afterNode ? displayPath(shadow, id, newName) : newName;
            noteChange('rename', recordKey('rename', id), { before, path: disp, newPath: newDisp });
            return { success: true };
        },
        updateFileContent: (fileId: string, content: string) => {
            const node = findNodeById(shadow as never, fileId) as FileNode | null;
            if (!node) return { success: false, error: `Preview: file not found` };
            const before = typeof node.content === 'string' ? node.content : null;
            if (before === content) return { success: true };
            const r = opUpdateFileContent(shadow, fileId, content);
            if (r.error || !r.changed) {
                const e = r.error as { message?: string } | string | undefined;
                return { success: false, error: typeof e === 'string' ? e : e?.message ?? 'Preview: update failed' };
            }
            shadow = r.tree;
            noteChange('update', recordKey('update', fileId), { before, path: displayPath(shadow, fileId, node.name) });
            return { success: true };
        },
        getActiveFilePath: () => pinned.fileName,
        getActiveFileId: () => pinned.fileId,
    };

    const getChanges = (): ProposedChange[] => {
        const out: ProposedChange[] = [];
        for (const key of order) {
            const entry = beforeMap.get(key);
            if (!entry) continue;
            if (entry.kind === 'create') {
                const after = deps.getFileContent(entry.path);
                out.push({ kind: 'create', path: entry.path, fileId: null, before: null, after });
            } else if (entry.kind === 'delete') {
                const id = key.slice('delete:'.length);
                out.push({ kind: 'delete', path: entry.path, fileId: id, before: entry.before, after: null });
            } else if (entry.kind === 'rename') {
                const id = key.slice('rename:'.length);
                const afterNode = findNodeById(shadow as never, id) as FileNode | null;
                const after = afterNode && afterNode.type === 'file' && typeof afterNode.content === 'string' ? afterNode.content : null;
                out.push({ kind: 'rename', path: entry.path, fileId: id, before: entry.before, after, newPath: entry.newPath });
            } else {
                const id = key.slice('update:'.length);
                const after = deps.getFileIdByPath(entry.path)
                    ? deps.getFileContent(entry.path)
                    : (() => {
                        const n = findNodeById(shadow as never, id) as FileNode | null;
                        return n && n.type === 'file' && typeof n.content === 'string' ? n.content : null;
                    })();
                if (after !== entry.before) {
                    out.push({ kind: 'update', path: entry.path, fileId: id, before: entry.before, after });
                }
            }
        }
        return out;
    };

    return { deps, getShadowTree: () => shadow, getChanges };
}
