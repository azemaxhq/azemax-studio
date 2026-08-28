/**
 * Canonical filesystem mutation layer.
 *
 * EVERY mutation of the project tree must go through this module. UI
 * components, the shell, and AI-generated create_file/update_file/create_folder
 * actions all call these operations; nobody is allowed to push/splice/assign
 * node.children directly.
 *
 * Guarantees for every operation:
 *   - the input tree is never mutated (immutable updates)
 *   - the parent is resolved by stable id and verified to exist + be a folder
 *   - every new node gets a brand-new, globally-unique OPAQUE id
 *     (identity is decoupled from name/path; rename/move preserve ids)
 *   - sibling name uniqueness is computed against the CURRENT committed tree
 *     (not a stale snapshot), so batched operations can never collide
 *   - move/copy reject any target that is the source or inside the source's
 *     subtree (cycle prevention at the DATA layer)
 *   - the result is structurally validated before it is returned
 *   - every result is `{ tree, changed, error?, node?, remap? }`
 *     (`remap` is currently unused — ids are stable — but kept for contract)
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID, generateNodeId } from '../../utils/mockFileSystem';
import {
    findNodeById,
    findChildByName,
    deleteNodeById,
    insertNodeIntoFolder,
    updateNodeById,
    walkTree,
    isDescendantOf,
    MAX_TREE_DEPTH,
} from '../../utils/safeTree';
import { validateFileTree } from './validate';
import type { CreateNodeInput, TreeOperationResult, TreeErrorCode } from './types';
import { failureResult, noopResult } from './types';

const isNameValid = (name: string): { ok: boolean; error?: string } => {
    if (typeof name !== 'string' || !name.trim()) {
        return { ok: false, error: 'Name cannot be empty' };
    }
    if (name !== name.trim()) {
        return { ok: false, error: 'Name cannot start or end with spaces' };
    }
    if (/[<>:"|?*\\/]/.test(name)) {
        return { ok: false, error: 'Name contains invalid characters' };
    }
    if (name.length > 255) {
        return { ok: false, error: 'Name too long' };
    }
    return { ok: true };
};

/** Sibling list of `parentId` in the CURRENT tree (null when parent missing). */
function siblingsOf(tree: readonly FileNode[], parentId: string): FileNode[] | null {
    if (parentId === ROOT_NODE_ID) {
        return (tree as FileNode[]).filter((n) => n.id !== ROOT_NODE_ID);
    }
    const parent = findNodeById(tree, parentId);
    if (!parent || parent.type !== 'folder') return null;
    return parent.children ?? [];
}

/** Unique sibling name against the ACTUAL current tree. */
function uniqueNameIn(
    tree: readonly FileNode[],
    parentId: string,
    desired: string,
    type: 'file' | 'folder',
): { name: string; ok: boolean; error?: TreeErrorCode; message?: string } {
    const siblings = siblingsOf(tree, parentId);
    if (siblings === null) {
        return {
            name: desired,
            ok: false,
            error: 'parent-not-found',
            message: 'Parent folder does not exist',
        };
    }
    const existing = new Set(siblings.map((s) => s.name.toLowerCase()));
    if (!existing.has(desired.toLowerCase())) return { name: desired, ok: true };

    let baseName: string;
    let extension: string;
    if (type === 'file') {
        const lastDot = desired.lastIndexOf('.');
        if (lastDot > 0) {
            baseName = desired.substring(0, lastDot);
            extension = desired.substring(lastDot);
        } else {
            baseName = desired;
            extension = '';
        }
    } else {
        baseName = desired;
        extension = '';
    }
    let counter = 1;
    while (existing.has(`${baseName} (${counter})${extension}`.toLowerCase())) counter++;
    return { name: `${baseName} (${counter})${extension}`, ok: true };
}

/** Validate the produced tree; reject the operation when it is structurally invalid. */
function commitValidated(result: TreeOperationResult, op: string): TreeOperationResult {
    const check = validateFileTree(result.tree);
    if (!check.valid) {
        if (typeof process === 'undefined' || process.env.NODE_ENV !== 'production') {
            console.warn(
                `[FileTree] Rejected invalid mutation\noperation=${op}\nreason=${check.issues
                    .slice(0, 3)
                    .map((i) => i.message)
                    .join('; ')}`,
            );
        }
        return failureResult(result.tree, 'invalid-state', 'Mutation would produce an invalid tree');
    }
    return result;
}

// ============================================================================
// create
// ============================================================================

/** Create a file. `parentId` defaults to the project root. */
export function createFile(tree: FileNode[], input: CreateNodeInput): TreeOperationResult {
    const nameCheck = isNameValid(input.name);
    if (!nameCheck.ok) {
        return failureResult(tree, 'invalid-name', nameCheck.error ?? 'Invalid name');
    }
    const parentId = input.parentId === undefined ? ROOT_NODE_ID : input.parentId;
    const named = uniqueNameIn(tree, parentId, input.name, 'file');
    if (!named.ok) {
        return failureResult(tree, 'parent-not-found', named.message ?? 'Parent folder does not exist');
    }

    const newNode: FileNode = {
        id: generateNodeId(),
        name: named.name,
        type: 'file',
        parentId,
    };
    if (typeof input.content === 'string' && input.content) newNode.content = input.content;

    const next = parentId === ROOT_NODE_ID
        ? [...tree, newNode]
        : insertNodeIntoFolder(tree, parentId, newNode, true);

    if (next === tree) {
        return failureResult(tree, 'parent-not-found', 'Parent folder does not exist');
    }
    return commitValidated(
        { tree: next, changed: next !== tree, node: newNode },
        'createFile',
    );
}

/** Create a folder. `parentId` defaults to the project root. */
export function createFolder(tree: FileNode[], input: CreateNodeInput): TreeOperationResult {
    const nameCheck = isNameValid(input.name);
    if (!nameCheck.ok) {
        return failureResult(tree, 'invalid-name', nameCheck.error ?? 'Invalid name');
    }
    const parentId = input.parentId === undefined ? ROOT_NODE_ID : input.parentId;
    const named = uniqueNameIn(tree, parentId, input.name, 'folder');
    if (!named.ok) {
        return failureResult(tree, 'parent-not-found', named.message ?? 'Parent folder does not exist');
    }

    const newNode: FileNode = {
        id: generateNodeId(),
        name: named.name,
        type: 'folder',
        parentId,
        children: [],
    };

    const next = parentId === ROOT_NODE_ID
        ? [...tree, newNode]
        : insertNodeIntoFolder(tree, parentId, newNode, true);

    if (next === tree) {
        return failureResult(tree, 'parent-not-found', 'Parent folder does not exist');
    }
    return commitValidated(
        { tree: next, changed: next !== tree, node: newNode },
        'createFolder',
    );
}

/**
 * Create every missing folder in a `/`-separated path (mkdir -p). Deterministic
 * against the CURRENT tree, so repeated calls never duplicate folders.
 * Returns the deepest folder node created (or the last existing one).
 */
export function ensureFolderPath(tree: FileNode[], path: string): TreeOperationResult {
    const parts = path.split('/').filter((p) => p.trim().length > 0);
    if (parts.length === 0) return noopResult(tree);

    let current = tree;
    let parentId = ROOT_NODE_ID;
    let lastNode: FileNode | undefined;
    let changed = false;

    for (const part of parts) {
        const nameCheck = isNameValid(part);
        if (!nameCheck.ok) return failureResult(tree, 'invalid-name', nameCheck.error ?? 'Invalid name');

        const existing = findChildByName(current, parentId, part);
        if (existing && existing.type === 'folder') {
            parentId = existing.id;
            lastNode = existing;
            continue;
        }
        const created = createFolder(current, { name: part, parentId });
        if (!created.changed || !created.node) {
            // Parent vanished mid-path (should not happen) — abort cleanly.
            return { tree: current, changed, error: created.error, node: lastNode };
        }
        current = created.tree;
        parentId = created.node.id;
        lastNode = created.node;
        changed = true;
    }

    return commitValidated({ tree: current, changed, node: lastNode }, 'ensureFolderPath');
}

// ============================================================================
// rename / move / copy / duplicate
// ============================================================================

/**
 * Clone `node` (and its whole subtree) assigning brand-new opaque ids so the
 * copy shares NO identity with the source. Used by copy/duplicate only —
 * rename/move preserve ids (a node's identity is its id, not its path).
 */
function cloneSubtree(node: FileNode, newParentId: string, newName?: string): FileNode {
    const root: FileNode = {
        ...node,
        id: generateNodeId(),
        name: newName ?? node.name,
        parentId: newParentId,
        isOpen: undefined,
    };
    if (node.type === 'folder' && Array.isArray(node.children)) {
        root.children = node.children.map((child) => cloneSubtree(child, root.id));
    } else {
        root.children = undefined;
    }
    return root;
}

/**
 * Rename a node (folder or file) in place. The node's id (and every descendant
 * id) is PRESERVED — only the name changes, so selection, active-file,
 * expansion, and bookmarks survive a rename untouched. No remap is produced.
 */
export function renameNode(tree: FileNode[], id: string, newName: string): TreeOperationResult {
    if (id === ROOT_NODE_ID) {
        return failureResult(tree, 'root-immutable', 'The project root cannot be renamed');
    }
    const nameCheck = isNameValid(newName);
    if (!nameCheck.ok) {
        return failureResult(tree, 'invalid-name', nameCheck.error ?? 'Invalid name');
    }
    const node = findNodeById(tree, id);
    if (!node) return failureResult(tree, 'node-not-found', 'Node does not exist');
    if (node.name === newName) return noopResult(tree);

    const parentId = node.parentId ?? ROOT_NODE_ID;
    const named = uniqueNameIn(tree, parentId, newName, node.type);
    if (!named.ok) {
        return failureResult(tree, 'parent-not-found', named.message ?? 'Parent folder does not exist');
    }
    if (named.name !== newName) {
        // Sibling collision — auto-suffix to keep names unique.
        return renameNode(tree, id, named.name);
    }

    const next = updateNodeById(tree, id, (n) => ({ ...n, name: newName }));
    if (next === tree) return noopResult(tree);
    return commitValidated(
        { tree: next, changed: true, node: findNodeById(next, id) ?? undefined },
        'renameNode',
    );
}

/**
 * Move a node into `targetFolderId`, PRESERVING the node and its subtree ids.
 * Only the moved node's parentId slot changes; children keep their
 * parentId === sourceId, which is still correct because the id was preserved.
 */
export function moveNode(tree: FileNode[], sourceId: string, targetFolderId: string): TreeOperationResult {
    if (sourceId === ROOT_NODE_ID) {
        return failureResult(tree, 'root-immutable', 'The project root cannot be moved');
    }
    if (sourceId === targetFolderId) {
        return failureResult(tree, 'self-move', 'A folder cannot be moved into itself');
    }
    const source = findNodeById(tree, sourceId);
    if (!source) return failureResult(tree, 'node-not-found', 'Source node does not exist');

    // Data-layer cycle prevention: reject target inside source's subtree.
    if (isDescendantOf(tree, sourceId, targetFolderId)) {
        return failureResult(
            tree,
            'move-into-descendant',
            'A folder cannot be moved into itself or one of its descendants',
        );
    }

    if (targetFolderId !== ROOT_NODE_ID) {
        const target = findNodeById(tree, targetFolderId);
        if (!target) return failureResult(tree, 'target-not-folder', 'Target folder does not exist');
        if (target.type !== 'folder') {
            return failureResult(tree, 'target-not-folder', 'Target is not a folder');
        }
    }

    const currentParent = source.parentId ?? ROOT_NODE_ID;
    if (currentParent === targetFolderId) return noopResult(tree);

    const moved: FileNode = { ...source, parentId: targetFolderId };
    let next = deleteNodeById(tree, sourceId);
    if (next === tree) return noopResult(tree);
    next = targetFolderId === ROOT_NODE_ID
        ? [...next, moved]
        : insertNodeIntoFolder(next, targetFolderId, moved, true);

    return commitValidated({ tree: next, changed: next !== tree, node: moved }, 'moveNode');
}

/** Copy a node into `targetFolderId` (clone with unique name + fresh ids). Rejects cycle targets. */
export function copyNode(tree: FileNode[], sourceId: string, targetFolderId: string): TreeOperationResult {
    if (sourceId === targetFolderId) {
        return failureResult(tree, 'self-move', 'A folder cannot be copied into itself');
    }
    const source = findNodeById(tree, sourceId);
    if (!source) return failureResult(tree, 'node-not-found', 'Source node does not exist');
    if (isDescendantOf(tree, sourceId, targetFolderId)) {
        return failureResult(
            tree,
            'move-into-descendant',
            'A folder cannot be copied into itself or one of its descendants',
        );
    }
    if (targetFolderId !== ROOT_NODE_ID) {
        const target = findNodeById(tree, targetFolderId);
        if (!target || target.type !== 'folder') {
            return failureResult(tree, 'target-not-folder', 'Target is not a folder');
        }
    }

    const named = uniqueNameIn(tree, targetFolderId, source.name, source.type);
    if (!named.ok) {
        return failureResult(tree, 'parent-not-found', named.message ?? 'Parent folder does not exist');
    }
    const clone = cloneSubtree(source, targetFolderId, named.name);

    const next = targetFolderId === ROOT_NODE_ID
        ? [...tree, clone]
        : insertNodeIntoFolder(tree, targetFolderId, clone, true);

    return commitValidated({ tree: next, changed: next !== tree, node: clone }, 'copyNode');
}

/** Duplicate a node in the same folder with a unique name and fresh ids. */
export function duplicateNode(tree: FileNode[], id: string): TreeOperationResult {
    const source = findNodeById(tree, id);
    if (!source) return failureResult(tree, 'node-not-found', 'Node does not exist');
    const parentId = source.parentId ?? ROOT_NODE_ID;
    return copyNode(tree, id, parentId);
}

// ============================================================================
// delete / update
// ============================================================================

/** Delete a node and its entire subtree. The canonical root is immutable. */
export function deleteNode(tree: FileNode[], id: string): TreeOperationResult {
    if (id === ROOT_NODE_ID) {
        return failureResult(tree, 'root-immutable', 'The project root cannot be deleted');
    }
    const node = findNodeById(tree, id);
    if (!node) return noopResult(tree);
    const next = deleteNodeById(tree, id);
    if (next === tree) return noopResult(tree);
    return commitValidated({ tree: next, changed: true }, 'deleteNode');
}

/** Update a file's content (id must resolve to a file). */
export function updateFileContent(tree: FileNode[], id: string, content: string): TreeOperationResult {
    const node = findNodeById(tree, id);
    if (!node) return failureResult(tree, 'node-not-found', 'File does not exist');
    if (node.type !== 'file') {
        return failureResult(tree, 'target-not-folder', 'Node is not a file');
    }
    if (node.content === content) return noopResult(tree);
    const next = updateNodeById(tree, id, (n) => (n.content === content ? n : { ...n, content }));
    if (next === tree) return noopResult(tree);
    return commitValidated({ tree: next, changed: true, node: findNodeById(next, id) ?? undefined }, 'updateFileContent');
}

/** Expand a folder (UI state) — mutates nothing in the filesystem tree. */
export function toggleFolderExpansion(
    _tree: FileNode[],
    folderId: string,
    expanded: ReadonlySet<string>,
): { expanded: Set<string> } {
    const next = new Set(expanded);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    return { expanded: next };
}

/** All folder ids in the tree (for expand-all / collapse-all). */
export function collectFolderIds(tree: readonly FileNode[]): Set<string> {
    const ids = new Set<string>();
    walkTree(tree, (node) => {
        if (node.type === 'folder') ids.add(node.id);
    });
    return ids;
}

// Re-exports for convenience.
export { MAX_TREE_DEPTH };