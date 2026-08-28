/**
 * Centralized, cycle-safe file-tree traversal utilities.
 *
 * Every consumer that walks the project file tree (Sidebar, FileExplorer,
 * ProjectContext, AI context building, the in-browser shell) must go through
 * this module instead of hand-written recursion. Rationale:
 *
 *  - The tree can arrive from an untrusted source (localStorage, imported
 *    projects, AI-driven edits) and may contain cycles, self-references,
 *    malformed nodes, or pathologically deep nesting.
 *  - A single `WeakSet`-guarded, iterative traversal terminates on all of
 *    those inputs, so a corrupt tree can never overflow the call stack
 *    ("too much recursion") or stall the main thread.
 *  - Nothing here mutates the input tree, so render paths stay pure.
 *
 * All traversals are bounded: depth is capped at MAX_TREE_DEPTH and total
 * visited nodes are implicitly bounded by the cycle guard plus the depth cap.
 */

import { ROOT_NODE_ID } from './mockFileSystem';
import type { FileNode } from './mockFileSystem';

export const MAX_TREE_DEPTH = 200;
export const MAX_TREE_NODES = 100_000;

const isObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object';

/** Safe children accessor — never throws on malformed nodes. */
export function childrenOf(node: FileNode | null | undefined): FileNode[] {
    return node && Array.isArray(node.children) ? node.children : [];
}

/**
 * Iterative, cycle-safe pre-order traversal.
 *
 * - Terminates on cycles and duplicate node identities via a WeakSet.
 * - Skips null / undefined / non-object nodes.
 * - Bounds depth (never descends below MAX_TREE_DEPTH).
 * - Never mutates the input tree.
 *
 * `visit(node, depth)` returning `false` prunes the node's subtree.
 */
export function walkTree(
    nodes: readonly FileNode[] | null | undefined,
    visit: (node: FileNode, depth: number) => boolean | void,
): void {
    if (!Array.isArray(nodes)) return;
    const visited = new WeakSet<object>();
    const stack: Array<{ node: FileNode; depth: number }> = [];
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (isObject(n)) stack.push({ node: n as unknown as FileNode, depth: 0 });
    }
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        if (visited.has(node)) continue;
        visited.add(node);
        const prune = visit(node, depth);
        if (prune === false) continue;
        if (depth >= MAX_TREE_DEPTH) continue;
        const kids = node.children;
        if (!Array.isArray(kids)) continue;
        for (let i = kids.length - 1; i >= 0; i--) {
            const child = kids[i];
            if (isObject(child)) stack.push({ node: child as unknown as FileNode, depth: depth + 1 });
        }
    }
}

/**
 * Validate + rebuild a file tree that may come from an untrusted source
 * (localStorage, imported projects, AI-driven edits). Guarantees:
 *   - only well-formed nodes survive (string id/name, type 'file'|'folder')
 *   - cycles and duplicate node identities are broken (WeakSet)
 *   - depth and total node count are bounded
 *   - the input is never mutated
 *
 * Returns a fresh, safe tree; `[]` for garbage input. Invalid nodes are
 * dropped but valid siblings/subtrees are preserved.
 */
export function sanitizeFileTree(input: unknown): FileNode[] {
    if (!Array.isArray(input)) {
        if (input != null) {
            console.warn('[safeTree] File tree is not an array; resetting to empty tree.');
        }
        return [];
    }
    const result: FileNode[] = [];
    const visited = new WeakSet<object>();
    let budget = MAX_TREE_NODES;

    const sanitizeLevel = (rawList: unknown, depth: number, out: FileNode[]): void => {
        if (!Array.isArray(rawList) || depth > MAX_TREE_DEPTH) return;
        for (const raw of rawList) {
            if (budget <= 0) return;
            if (!isObject(raw)) continue;
            if (visited.has(raw)) continue;
            visited.add(raw);
            budget--;

            const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
            const name = typeof raw.name === 'string' && raw.name ? raw.name : id ?? 'untitled';
            const hasChildren = Array.isArray(raw.children);
            const type: FileNode['type'] =
                raw.type === 'file' || raw.type === 'folder'
                    ? raw.type
                    : hasChildren
                        ? 'folder'
                        : 'file';

            const node: FileNode = {
                id: id ?? `${name}-${budget}`,
                name,
                type,
            };
            if (typeof raw.content === 'string') node.content = raw.content;
            if (typeof raw.isOpen === 'boolean') node.isOpen = raw.isOpen;

            if (type === 'folder') {
                const children: FileNode[] = [];
                sanitizeLevel(raw.children, depth + 1, children);
                node.children = children;
            }
            out.push(node);
        }
    };

    sanitizeLevel(input, 0, result);
    return result;
}

/** Count files and folders across the whole tree. */
export function countTree(
    nodes: readonly FileNode[] | null | undefined,
): { files: number; folders: number } {
    let files = 0;
    let folders = 0;
    walkTree(nodes, (node) => {
        if (node.type === 'folder') folders++;
        else files++;
    });
    return { files, folders };
}

/** True when any folder in the tree is currently expanded. */
export function anyFolderOpen(nodes: readonly FileNode[] | null | undefined): boolean {
    let found = false;
    walkTree(nodes, (node) => {
        if (node.type === 'folder' && node.isOpen) {
            found = true;
            return false;
        }
    });
    return found;
}

/** Flatten visible nodes (descends only into open folders) for keyboard nav. */
export function flattenTree(
    nodes: readonly FileNode[] | null | undefined,
    expanded?: ReadonlySet<string>,
): FileNode[] {
    const result: FileNode[] = [];
    walkTree(nodes, (node) => {
        result.push(node);
        const open = expanded ? expanded.has(node.id) : Boolean(node.isOpen);
        if (node.type === 'folder' && !open) return false;
    });
    return result;
}

/** Iterative, cycle-safe find by predicate. */
export function findNode(
    nodes: readonly FileNode[] | null | undefined,
    predicate: (node: FileNode) => boolean,
): FileNode | null {
    let found: FileNode | null = null;
    walkTree(nodes, (node) => {
        if (predicate(node)) {
            found = node;
            return false;
        }
    });
    return found;
}

/** Iterative, cycle-safe find by id. */
export function findNodeById(nodes: readonly FileNode[] | null | undefined, id: unknown): FileNode | null {
    if (typeof id !== 'string') return null;
    return findNode(nodes, (n) => n.id === id);
}

/** True when a node with `id` exists anywhere under `nodes`. */
export function containsNode(nodes: readonly FileNode[] | null | undefined, id: unknown): boolean {
    return findNodeById(nodes, id) !== null;
}

/**
 * Find a child by NAME directly under the folder with `parentId` (or under the
 * canonical root when `parentId === ROOT_NODE_ID`). Pure name resolution —
 * used by mkdir -p / AI create paths, which never know opaque ids.
 */
export function findChildByName(
    nodes: readonly FileNode[] | null | undefined,
    parentId: string,
    name: string,
): FileNode | null {
    if (!Array.isArray(nodes)) return null;
    if (parentId === ROOT_NODE_ID) {
        return nodes.find((n) => n.id !== ROOT_NODE_ID && n.name === name) ?? null;
    }
    const parent = findNodeById(nodes, parentId);
    if (!parent || parent.type !== 'folder') return null;
    return parent.children?.find((c) => c.name === name) ?? null;
}

/**
 * Derive the `/`-separated path of a node from its ANCESTRY (parentId chain),
 * not from the id string. Root is `''`; its children are their bare names.
 * Returns `''` when the node can't be found or its ancestry is dangling.
 */
export function pathOf(nodes: readonly FileNode[] | null | undefined, id: unknown): string {
    if (!Array.isArray(nodes) || id === ROOT_NODE_ID) return '';
    const seen = new Set<string>();
    const parts: string[] = [];
    let cur = typeof id === 'string' ? id : null;
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        const node = findNodeById(nodes, cur);
        if (!node || node.id === ROOT_NODE_ID) break;
        parts.push(node.name);
        const parent = node.parentId;
        if (!parent || parent === ROOT_NODE_ID) break;
        cur = parent;
    }
    parts.reverse();
    return parts.join('/');
}

/** Synthetic root node whose children are the top-level siblings. */
export function rootNode(nodes: readonly FileNode[] | null | undefined): FileNode {
    const kids = Array.isArray(nodes) ? nodes.filter((n) => n.id !== ROOT_NODE_ID) : [];
    return { id: ROOT_NODE_ID, name: 'root', type: 'folder', children: kids };
}

/**
 * Resolve a `/`-separated path to a node, walking NAMES from the canonical
 * root. Supports absolute (`/...`), `~`, `.` and `..`. Returns null when any
 * segment is missing. Cycle-safe (bounded by node identity + budget).
 */
export function resolvePath(
    nodes: readonly FileNode[] | null | undefined,
    path: string,
): FileNode | null {
    if (!Array.isArray(nodes) || typeof path !== 'string') return null;
    let cleaned = path.trim();
    if (cleaned.startsWith('~')) {
        cleaned = cleaned.replace(/^~\//, '');
    } else if (cleaned.startsWith('/')) {
        cleaned = cleaned.replace(/^\/+/, '');
    }
    let current = rootNode(nodes);
    if (cleaned === '' || cleaned === '/') return current;

    let budget = MAX_TREE_NODES;
    for (const raw of cleaned.split('/')) {
        if (budget-- <= 0) return null;
        const part = raw.trim();
        if (!part || part === '.') continue;
        if (part === '..') {
            if (current.id === ROOT_NODE_ID) continue;
            const parent = current.parentId ? findNodeById(nodes, current.parentId) : null;
            current = parent && parent.type === 'folder' ? parent : rootNode(nodes);
            continue;
        }
        const kids = current.id === ROOT_NODE_ID
            ? nodes.filter((n) => n.id !== ROOT_NODE_ID)
            : current.children ?? [];
        const next = kids.find((n) => n.name === part);
        if (!next) return null;
        current = next;
    }
    return current;
}

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** IDE ordering: folders before files, then natural (numeric-aware) by name. */
export function compareNodes(a: FileNode, b: FileNode): number {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return naturalCollator.compare(a.name, b.name);
}

/**
 * Return a structurally-shared copy of the tree with every level sorted
 * folders-first + natural-alpha. Levels whose order already matches are
 * returned untouched (identity preserved for memoized subtrees). Cycle-safe
 * and never mutates the input.
 */
export function sortTree(nodes: readonly FileNode[] | null | undefined): FileNode[] {
    if (!Array.isArray(nodes)) return [];
    const visited = new WeakSet<object>();

    const sortLevel = (level: readonly FileNode[]): FileNode[] => {
        let changed = false;
        const mapped: FileNode[] = [];
        for (const node of level) {
            if (!isObject(node)) { changed = true; continue; }
            const n = node as FileNode;
            if (visited.has(n)) { changed = true; continue; }
            visited.add(n);
            if (n.type === 'folder' && Array.isArray(n.children)) {
                const kids = sortLevel(n.children);
                if (kids !== n.children) {
                    changed = true;
                    mapped.push({ ...n, children: kids });
                    continue;
                }
            }
            mapped.push(n);
        }
        const sorted = [...mapped].sort((a, b) => {
            if (a.id === ROOT_NODE_ID) return -1;
            if (b.id === ROOT_NODE_ID) return 1;
            return compareNodes(a, b);
        });
        if (sorted.length !== level.length) changed = true;
        if (!changed) {
            for (let i = 0; i < mapped.length; i++) {
                if (mapped[i] !== sorted[i]) { changed = true; break; }
            }
        }
        return changed ? sorted : (level as FileNode[]);
    };

    return sortLevel(nodes);
}

// ============================================================================
// Iterative, cycle-safe structural updates (update / delete / insert)
//
// A single WeakSet-guarded, fully iterative path finder locates the target and
// records the root→target slot path; the tree is then REBUILT from the target
// back up to the root, cloning ONLY the changed node and its ancestor chain.
// Untouched branches keep their exact object identity (React memo bails out),
// the input is never mutated, and cyclic / duplicate-reference / pathologically
// deep trees terminate deterministically.
// ============================================================================

/** One slot in a parent list: the node at `list[index]`. */
interface PathFrame {
    list: readonly FileNode[];
    index: number;
}

interface PathEdit {
    kind: 'replace' | 'remove' | 'insert';
    node?: FileNode;
    open?: boolean;
}

/** Root→target slot path (inclusive) for `id`, or null when not found. */
function findPathTo(roots: readonly FileNode[], id: string): PathFrame[] | null {
    interface Frame extends PathFrame {
        parent: Frame | null;
    }
    const visited = new WeakSet<object>();
    const stack: Frame[] = [];
    for (let i = roots.length - 1; i >= 0; i--) {
        const n = roots[i];
        if (isObject(n)) stack.push({ list: roots, index: i, parent: null });
    }
    let budget = MAX_TREE_NODES;
    while (stack.length > 0) {
        if (budget-- <= 0) return null;
        const frame = stack.pop()!;
        const node = frame.list[frame.index] as FileNode;
        if (!isObject(node) || visited.has(node)) continue;
        visited.add(node);
        if (node.id === id) {
            const path: PathFrame[] = [];
            let cur: Frame | null = frame;
            while (cur) {
                path.push({ list: cur.list, index: cur.index });
                cur = cur.parent;
            }
            return path.reverse();
        }
        const kids = node.children;
        if (!Array.isArray(kids)) continue;
        for (let i = kids.length - 1; i >= 0; i--) {
            const child = kids[i];
            if (isObject(child)) stack.push({ list: kids, index: i, parent: frame });
        }
    }
    return null;
}

/**
 * Rebuild the tree along `path` (root→target) applying `edit`. Clones only the
 * edited node and its ancestors; every other node/array keeps its identity.
 * Returns null when the edit is a no-op (nothing to change).
 */
function rebuildPath(roots: readonly FileNode[], path: PathFrame[], edit: PathEdit): FileNode[] | null {
    const last = path[path.length - 1];
    const lastNode = last.list[last.index] as FileNode;

    if (edit.kind === 'replace' && edit.node === lastNode) return null;

    // Deleting a top-level node: only the root list changes.
    if (edit.kind === 'remove' && path.length === 1) {
        const next = roots.filter((_, i) => i !== last.index);
        return next.length === roots.length ? null : next;
    }

    // `current` is the replacement node bubbling up the ancestor chain.
    let current: FileNode | null = null;
    for (let i = path.length - 1; i >= 0; i--) {
        const frame = path[i];
        const node = frame.list[frame.index] as FileNode;

        if (i === path.length - 1) {
            if (edit.kind === 'replace') {
                current = edit.node ?? null;
            } else if (edit.kind === 'insert') {
                const kids = Array.isArray(node.children) ? node.children : [];
                current = { ...node, children: [...kids, edit.node!], isOpen: edit.open ? true : node.isOpen };
            } else {
                current = null; // remove: slot is dropped at the level above
            }
            continue;
        }

        const childIndex = path[i + 1].index;
        const childList = node.children;
        if (!Array.isArray(childList)) return null;
        let newChildren: FileNode[];
        if (edit.kind === 'remove' && i === path.length - 2) {
            newChildren = childList.filter((_, idx) => idx !== childIndex);
            if (newChildren.length === childList.length) return null;
        } else if (current === null) {
            return null;
        } else {
            newChildren = childList.map((c, idx) => (idx === childIndex ? current! : c));
        }
        current = { ...node, children: newChildren };
    }
    if (current === null) return null;
    const rootFrame = path[0];
    return rootFrame.list.map((n, idx) => (idx === rootFrame.index ? current! : n));
}

/**
 * Iterative, cycle-safe, structurally-shared node update. `apply` returns the
 * replacement node, or the SAME node / null / undefined to signal "no change".
 * Returns the original tree reference when the target is missing or unchanged.
 */
export function updateNodeById(
    nodes: readonly FileNode[] | null | undefined,
    id: unknown,
    apply: (node: FileNode) => FileNode | null | undefined,
): FileNode[] {
    if (typeof id !== 'string' || !Array.isArray(nodes)) return (nodes ?? []) as FileNode[];
    const path = findPathTo(nodes, id);
    if (!path) return nodes as FileNode[];
    const target = path[path.length - 1].list[path[path.length - 1].index] as FileNode;
    const replacement = apply(target);
    if (replacement === null || replacement === undefined || replacement === target) {
        return nodes as FileNode[];
    }
    return rebuildPath(nodes, path, { kind: 'replace', node: replacement }) ?? (nodes as FileNode[]);
}

/** Iterative, cycle-safe, structurally-shared node removal. */
export function deleteNodeById(
    nodes: readonly FileNode[] | null | undefined,
    id: unknown,
): FileNode[] {
    if (typeof id !== 'string' || !Array.isArray(nodes)) return (nodes ?? []) as FileNode[];
    const path = findPathTo(nodes, id);
    if (!path) return nodes as FileNode[];
    return rebuildPath(nodes, path, { kind: 'remove' }) ?? (nodes as FileNode[]);
}

/**
 * Iterative, cycle-safe, structurally-shared insert: append `nodeToAdd` to the
 * children of the folder with `folderId`, cloning only that folder's ancestor
 * chain. Returns the original tree reference when the folder is missing.
 */
export function insertNodeIntoFolder(
    nodes: readonly FileNode[] | null | undefined,
    folderId: unknown,
    nodeToAdd: FileNode,
    open = true,
): FileNode[] {
    if (typeof folderId !== 'string' || !Array.isArray(nodes)) return (nodes ?? []) as FileNode[];
    const path = findPathTo(nodes, folderId);
    if (!path) return nodes as FileNode[];
    return rebuildPath(nodes, path, { kind: 'insert', node: nodeToAdd, open }) ?? (nodes as FileNode[]);
}

/**
 * Cycle-safe, depth-bounded, structurally-shared full-tree transform. Every
 * node is passed through `transform`; returning the same node keeps its
 * identity, and unchanged subtrees are never cloned. Cycles and duplicate
 * references are broken via a WeakSet; recursion is bounded by MAX_TREE_DEPTH.
 */
export function mapTree(
    nodes: readonly FileNode[] | null | undefined,
    transform: (node: FileNode, depth: number) => FileNode,
): FileNode[] {
    if (!Array.isArray(nodes)) return [];
    const visited = new WeakSet<object>();
    const mapLevel = (level: readonly FileNode[], depth: number): { list: FileNode[]; changed: boolean } => {
        const out: FileNode[] = [];
        let changed = false;
        for (const raw of level) {
            if (!isObject(raw) || visited.has(raw)) continue;
            visited.add(raw);
            const node = raw as FileNode;
            const isFolder = node.type === 'folder';
            const kids = node.children;
            const kidResult =
                isFolder && depth < MAX_TREE_DEPTH && Array.isArray(kids)
                    ? mapLevel(kids, depth + 1)
                    : { list: undefined, changed: false };
            const kidList = kidResult.list;
            const kidsChanged = Array.isArray(kidList) && kidList !== kids;
            const next = transform(node, depth);
            if (next === node && !kidsChanged) {
                out.push(node);
            } else {
                changed = true;
                out.push({
                    ...next,
                    children: isFolder ? (Array.isArray(kidList) ? kidList : kids) : undefined,
                });
            }
        }
        if (out.length !== level.length) changed = true;
        return { list: changed ? out : (level as FileNode[]), changed };
    };
    const result = mapLevel(nodes, 0);
    return result.changed ? result.list : (nodes as FileNode[]);
}

/** Collect every node id in the tree (deduplicated). */
export function collectIds(nodes: readonly FileNode[] | null | undefined): Set<string> {
    const ids = new Set<string>();
    walkTree(nodes, (node) => {
        void ids.add(node.id);
    });
    return ids;
}

/** Collect every file node in the tree. */
export function collectFiles(nodes: readonly FileNode[] | null | undefined): FileNode[] {
    const files: FileNode[] = [];
    walkTree(nodes, (node) => {
        if (node.type === 'file') files.push(node);
    });
    return files;
}

/** True when `descendantId` lives inside the subtree rooted at `ancestorId`. */
export function isDescendantOf(
    nodes: readonly FileNode[] | null | undefined,
    ancestorId: unknown,
    descendantId: unknown,
): boolean {
    if (typeof ancestorId !== 'string' || typeof descendantId !== 'string') return false;
    if (ancestorId === descendantId) return true;
    const ancestor = findNodeById(nodes, ancestorId);
    if (!ancestor) return false;
    let found = false;
    walkTree(ancestor.children ?? [], (node) => {
        if (node.id === descendantId) {
            found = true;
            return false;
        }
    });
    return found;
}

export interface FilterTreeOptions {
    /** Return true when a node matches on its own merits. */
    predicate?: (node: FileNode, depth: number) => boolean;
    /** Return true to hard-exclude a node AND prune its subtree (e.g. hidden files). */
    skip?: (node: FileNode, depth: number) => boolean;
    /** Force folders open (search mode). */
    forceOpen?: boolean;
    /** Depth cap for recursion (defaults to MAX_TREE_DEPTH). */
    maxDepth?: number;
}

/**
 * Cycle-safe tree filter that preserves structure via structural sharing.
 * A node is kept when it self-matches (`predicate`) OR has a matching
 * descendant. `skip` prunes a node and its subtree entirely.
 */
export function filterTree(nodes: readonly FileNode[] | null | undefined, options: FilterTreeOptions = {}): FileNode[] {
    if (!Array.isArray(nodes)) return [];
    const { predicate, skip, forceOpen = false, maxDepth = MAX_TREE_DEPTH } = options;
    const visited = new WeakSet<object>();

    // Returns the filtered level plus a `changed` flag. When a node's subtree
    // survived unchanged, the ORIGINAL node object is pushed (structural
    // sharing) so memoized subtree components don't re-render — instead of the
    // previous behavior which cloned every node on every filter run.
    const filterLevel = (level: readonly FileNode[], depth: number): { list: FileNode[]; changed: boolean } => {
        const out: FileNode[] = [];
        let changed = false;
        for (const node of level) {
            if (!isObject(node) || visited.has(node)) continue;
            visited.add(node);
            if (skip && skip(node as FileNode, depth)) { changed = true; continue; }
            const isFolder = (node as FileNode).type === 'folder';
            const kids = (node as FileNode).children;
            const kidResult =
                isFolder && depth < maxDepth && Array.isArray(kids)
                    ? filterLevel(kids, depth + 1)
                    : { list: undefined, changed: false };
            const selfMatch = !predicate || predicate(node as FileNode, depth);
            const kidList = kidResult.list;
            const keep = selfMatch || (Array.isArray(kidList) && kidList.length > 0);
            if (!keep) { changed = true; continue; }

            const kidsChanged = Array.isArray(kidList) && kidList !== kids;
            const needsForceOpen = forceOpen && isFolder && (node as FileNode).isOpen !== true;
            if (selfMatch && !kidsChanged && !needsForceOpen) {
                // Unchanged subtree: preserve identity.
                out.push(node as FileNode);
            } else {
                changed = true;
                out.push({
                    ...(node as FileNode),
                    isOpen: forceOpen && isFolder ? true : (node as FileNode).isOpen,
                    children: isFolder ? (Array.isArray(kidList) ? kidList : kids) : undefined,
                });
            }
        }
        if (out.length !== level.length) changed = true;
        return { list: out, changed };
    };

    return filterLevel(nodes, 0).list;
}

/** Indented file-tree listing for AI context, cycle-safe and depth-bounded. */
export function flattenFileTreeString(
    nodes: readonly FileNode[] | null | undefined,
    startDepth = 0,
    maxDepth = 2,
): string {
    if (!Array.isArray(nodes)) return '';
    let result = '';
    walkTree(nodes, (node, d) => {
        const depth = startDepth + d;
        if (depth > maxDepth) return false;
        result += `${'  '.repeat(depth)} - ${node.name} (${node.type}) \n`;
    });
    return result;
}
