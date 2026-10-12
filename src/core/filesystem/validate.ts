/**
 * Structural validation + deterministic repair for the file tree.
 *
 * The tree can arrive from untrusted sources (localStorage, imported projects,
 * AI-driven edits) and may contain cycles, self-references, duplicate ids,
 * shared object references, malformed nodes, or pathologically deep nesting.
 * This module is the ONLY place allowed to decide "is this tree valid" and
 * "how do I make it valid again". Everything here is iterative / cycle-safe —
 * it never recursively walks untrusted data.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { derivePath, parentIdOf, nameOf } from './paths';
import { MAX_TREE_DEPTH, MAX_TREE_NODES, walkTree } from '../../utils/safeTree';

const isObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object';

/** A detected validity problem. */
export interface ValidationIssue {
    nodeId?: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    /** Total nodes traversed (capped) — useful for diagnostics. */
    nodeCount: number;
}

/**
 * Iterative, cycle-safe structural validation.
 *
 * Invariants enforced:
 *   - the tree is an array
 *   - AT MOST one canonical root (id === ROOT_NODE_ID) exists at the top level
 *     (an empty array is the explicit no-workspace state and is valid)
 *   - every node has a non-empty string id/name and a valid type
 *   - a node id appears exactly once
 *   - no node object appears more than once (no shared references, no cycles)
 *   - folders have array children; files never have children
 *   - every non-root node's parentId matches the folder that actually contains it
 *   - depth never exceeds MAX_TREE_DEPTH
 */
export function validateFileTree(nodes: unknown): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (!Array.isArray(nodes)) {
        return {
            valid: false,
            nodeCount: 0,
            issues: [{ message: 'File tree must be an array' }],
        };
    }

    const seenIds = new Set<string>();
    const seenCounts = new Map<object, number>();
    let rootCount = 0;
    let nodeCount = 0;

    interface Frame {
        list: readonly unknown[];
        index: number;
        parentId: string | null; // expected parent id (null = top level)
        depth: number;
    }

    const stack: Frame[] = [];
    for (let i = nodes.length - 1; i >= 0; i--) {
        stack.push({ list: nodes, index: i, parentId: null, depth: 0 });
    }

    let budget = MAX_TREE_NODES;
    while (stack.length > 0) {
        if (budget-- <= 0) {
            issues.push({ message: 'Node count exceeds the configured limit' });
            break;
        }
        const frame = stack.pop()!;
        const raw = frame.list[frame.index];
        if (!isObject(raw)) {
            issues.push({ message: 'Non-object node in the tree' });
            continue;
        }
        const node = raw as unknown as FileNode;

        // Duplicate object reference (shared identity or cycle) — invalid.
        const prior = seenCounts.get(node) ?? 0;
        if (prior > 0) {
            issues.push({
                nodeId: typeof node.id === 'string' ? node.id : undefined,
                message: 'Duplicate node object reference (shared identity or cycle)',
            });
            continue;
        }
        seenCounts.set(node, 1);

        const isCanonicalRoot = node.id === ROOT_NODE_ID;
        if (isCanonicalRoot) {
            rootCount++;
            if (frame.depth !== 0) {
                issues.push({ nodeId: node.id, message: 'Canonical root must live at the top level' });
            }
        }

        // Basic node shape.
        if (typeof node.id !== 'string' || !node.id) {
            issues.push({ message: 'Node is missing a non-empty id' });
        } else if (seenIds.has(node.id)) {
            issues.push({ nodeId: node.id, message: 'Duplicate node id' });
        } else {
            seenIds.add(node.id);
        }
        if (typeof node.name !== 'string' || !node.name) {
            issues.push({ nodeId: node.id, message: 'Node is missing a non-empty name' });
        }
        if (node.type !== 'file' && node.type !== 'folder') {
            issues.push({ nodeId: node.id, message: `Invalid node type: ${String(node.type)}` });
        }
        nodeCount++;

        // Depth cap (also keeps the walk itself bounded).
        if (frame.depth > MAX_TREE_DEPTH) {
            issues.push({ nodeId: node.id, message: 'Tree depth exceeds the configured limit' });
            continue;
        }

        // parentId must match the physical parent.
        const expectedParent =
            frame.parentId === null
                ? isCanonicalRoot
                    ? undefined
                    : ROOT_NODE_ID
                : frame.parentId;
        if (node.parentId !== expectedParent) {
            issues.push({
                nodeId: node.id,
                message: `parentId mismatch: expected ${String(expectedParent)}, found ${String(node.parentId)}`,
            });
        }
        if (!isCanonicalRoot && node.parentId === node.id) {
            issues.push({ nodeId: node.id, message: 'Folder contains itself' });
        }

        const kids = (node as { children?: unknown }).children;
        if (node.type === 'file') {
            if (kids !== undefined && kids !== null) {
                issues.push({ nodeId: node.id, message: 'Files must not have children' });
            }
            continue;
        }
        if (kids !== undefined && !Array.isArray(kids)) {
            issues.push({ nodeId: node.id, message: 'Folder children must be an array' });
            continue;
        }
        if (!Array.isArray(kids)) continue;
        for (let i = kids.length - 1; i >= 0; i--) {
            stack.push({ list: kids, index: i, parentId: node.id, depth: frame.depth + 1 });
        }
    }

    if (rootCount > 1) {
        issues.push({ message: `Expected at most one canonical root, found ${rootCount}` });
    }

    return { valid: issues.length === 0, issues, nodeCount };
}

/** Throws a descriptive Error when the tree is invalid (dev/test helper). */
export function assertValidFileTree(nodes: unknown): void {
    const result = validateFileTree(nodes);
    if (!result.valid) {
        throw new Error(
            `Invalid file tree:\n${result.issues
                .slice(0, 20)
                .map((i) => `  - ${i.nodeId ?? '(unknown)'}: ${i.message}`)
                .join('\n')}${result.issues.length > 20 ? `\n  ...and ${result.issues.length - 20} more` : ''}`,
        );
    }
}

export interface RepairResult {
    tree: FileNode[];
    /** Expansion ids recovered from legacy `isOpen` flags on folders. */
    expansion: Set<string>;
    repaired: boolean;
}

const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * The default project name historically materialized by the empty-storage
 * fallback (`initialFileTree`) and by repair recovery paths. A persisted tree
 * that contains NOTHING but a bare root with this exact name is positively
 * identified as that generated placeholder — never user content — and repair
 * collapses it to the explicit no-workspace state (`[]`). Any tree carrying
 * real content (siblings, children, files) is preserved untouched, whatever
 * it is named.
 */
const PLACEHOLDER_ROOT_NAME = 'deep-context-ide';

function isBarePlaceholderRoot(tree: FileNode[]): boolean {
    if (tree.length !== 1) return false;
    const only = tree[0];
    return (
        only.id === ROOT_NODE_ID &&
        only.name === PLACEHOLDER_ROOT_NAME &&
        (only.children ?? []).length === 0 &&
        (only.content ?? '') === ''
    );
}

/**
 * Deterministically repair untrusted tree data into a valid runtime tree.
 *
 *   1. Coerce to an array; recover legacy `isOpen` flags into an expansion set.
 *      Non-array input and an empty array both repair to the explicit
 *      no-workspace state (`[]`) — repair NEVER invents a placeholder project.
 *   2. Walk iteratively with a WeakSet (cycles/shared refs are broken) and a
 *      depth cap so pathological input terminates.
 *   3. Normalize each node (id/name/type/content), strip UI-only `isOpen`,
 *      and make every id globally unique.
 *   4. Preserve the canonical shape (at most one root at the top level;
 *      top-level items stay siblings of the root) and rebuild every node's
 *      parentId from its actual location. Rootless trees are kept rootless —
 *      no folder is ever promoted and no root is ever fabricated.
 *   5. Collapse a bare default-named root (the known generated placeholder)
 *      to `[]`. Re-validate; on failure recover to `[]` rather than a
 *      fabricated project.
 *
 * The input is never mutated.
 */
export function repairFileTree(input: unknown): RepairResult {
    let repaired = false;
    const expansion = new Set<string>();
    if (!Array.isArray(input)) {
        return { tree: [], expansion, repaired: true };
    }

    // ---- Pass 1: iterative, cycle-safe normalization ----
    const visited = new WeakSet<object>();
    let budget = MAX_TREE_NODES;

    const normalizeList = (rawList: unknown, depth: number, out: FileNode[]): void => {
        if (!Array.isArray(rawList) || depth > MAX_TREE_DEPTH) return;
        for (const raw of rawList) {
            if (budget-- <= 0) {
                repaired = true;
                return;
            }
            if (!isObject(raw)) {
                repaired = true;
                continue;
            }
            if (visited.has(raw)) {
                // Shared reference or cycle — keep only the first occurrence.
                repaired = true;
                continue;
            }
            visited.add(raw);

            const rawId = isString(raw.id) && (raw.id as string) ? (raw.id as string) : undefined;
            const rawName =
                isString(raw.name) && (raw.name as string).trim() ? (raw.name as string) : undefined;
            const name = rawName ?? (rawId ? nameOf(rawId) : undefined) ?? 'untitled';
            const hasChildren = Array.isArray(raw.children);
            const type: FileNode['type'] =
                raw.type === 'file' || raw.type === 'folder'
                    ? raw.type
                    : hasChildren
                        ? 'folder'
                        : 'file';

            if (type === 'folder' && typeof raw.isOpen === 'boolean' && raw.isOpen && rawId) {
                expansion.add(rawId);
            }

            const node: FileNode = { id: rawId ?? '', name, type };
            if (typeof raw.content === 'string') node.content = raw.content;

            if (type === 'folder') {
                const children: FileNode[] = [];
                normalizeList(raw.children, depth + 1, children);
                node.children = children;
            }
            out.push(node);
        }
    };

    const rawRoots: FileNode[] = [];
    normalizeList(input, 0, rawRoots);

    if (rawRoots.length === 0) {
        // Already the explicit no-workspace state — nothing to change.
        return { tree: [], expansion, repaired: false };
    }

    // ---- Pass 2: canonical root resolution ----
    // At most one root survives at the top level; everything else stays a
    // sibling. A rootless tree is legitimate (it is how a workspace created
    // from the empty state looks) and is preserved as-is — nothing is
    // promoted and no root container is fabricated.
    let rootNode: FileNode | null = null;
    const others: FileNode[] = [];
    for (const node of rawRoots) {
        if (node.id === ROOT_NODE_ID) {
            if (rootNode === null) rootNode = node;
            else {
                others.push(node);
                repaired = true;
            }
        } else {
            others.push(node);
        }
    }

    // Normalize the canonical model: top-level items are SIBLINGS of the root
    // node (matching the runtime creation convention). Legacy data that placed
    // items inside root.children is flattened to the top level.
    if (rootNode && Array.isArray(rootNode.children) && rootNode.children.length > 0) {
        for (const child of rootNode.children) {
            if (isObject(child)) others.push(child as FileNode);
        }
        rootNode.children = [];
        repaired = true;
    }

    if (rootNode) {
        rootNode.id = ROOT_NODE_ID;
        rootNode.parentId = undefined;
        rootNode.isOpen = undefined;
    }

    // ---- Pass 3: rebuild ids + parentId, dedupe globally ----
    // Valid, globally-unique ids (opaque uuids OR legacy path ids) are
    // PRESERVED so persisted active-file/bookmark ids keep resolving. Only
    // missing or duplicate ids are repaired deterministically (path-derived
    // base + numeric suffix), so the same input always repairs to the same tree.
    const usedIds = new Set<string>();
    const reId = (node: FileNode, parentId: string, depth: number, isRoot: boolean): void => {
        node.isOpen = undefined;
        if (node.type === 'folder' && Array.isArray(node.children) && depth >= MAX_TREE_DEPTH) {
            node.children = undefined;
            repaired = true;
        }
        if (isRoot) {
            // Canonical root has no parent (top-level container).
            node.id = ROOT_NODE_ID;
            node.parentId = undefined;
            usedIds.add(ROOT_NODE_ID);
        } else {
            const oldId = node.id;
            node.parentId = parentId;
            // A sibling must never carry the canonical root id (a duplicate-root
            // legacy node is re-id'd deterministically instead of kept).
            const keep = oldId !== ROOT_NODE_ID && isString(oldId) && oldId !== '' && !usedIds.has(oldId);
            let id: string;
            if (keep) {
                id = oldId as string;
            } else {
                const base = derivePath(parentId, node.name);
                id = base;
                let n = 1;
                while (usedIds.has(id)) {
                    id = `${base} (${n})`;
                    n++;
                }
                repaired = true;
            }
            usedIds.add(id);
            node.id = id;
            // Keep recovered expansion ids in sync when a node's id is
            // re-derived (e.g. legacy root.children flattened to top level).
            if (expansion.has(oldId) && oldId !== id) {
                expansion.delete(oldId);
                expansion.add(id);
            }
        }
        if (node.type === 'folder' && Array.isArray(node.children)) {
            for (const child of node.children) {
                reId(child, node.id, depth + 1, false);
            }
        } else {
            node.children = undefined;
        }
    };

    if (rootNode) {
        reId(rootNode, ROOT_NODE_ID, 0, true);
    }
    const top: FileNode[] = rootNode ? [rootNode] : [];
    for (const other of others) {
        reId(other, ROOT_NODE_ID, 1, false);
        top.push(other);
    }

    // ---- Pass 4: collapse the known placeholder; validate; recover ----
    // A bare default-named root is the generated placeholder — collapse it to
    // the explicit no-workspace state. Anything carrying real content is
    // preserved untouched, whatever it is named.
    if (isBarePlaceholderRoot(top)) {
        return { tree: [], expansion, repaired: true };
    }
    const result = validateFileTree(top);
    if (!result.valid) {
        console.warn(`[FileTree] Repair produced an invalid tree; recovering to the explicit no-workspace state.`);
        return { tree: [], expansion, repaired: true };
    }

    // Expansion ids recovered from legacy `isOpen` flags may reference ids that
    // were re-derived during repair (e.g. root.children flattened to the top
    // level). Drop any that no longer resolve to a folder so the UI expansion
    // set never carries stale entries.
    if (expansion.size > 0) {
        const folderIds = new Set<string>();
        walkTree(top, (node) => {
            if (node.type === 'folder') folderIds.add(node.id);
        });
        for (const id of expansion) {
            if (!folderIds.has(id)) expansion.delete(id);
        }
    }

    return { tree: top, expansion, repaired };
}

// Re-export path helpers used by consumers of the canonical layer.
export { parentIdOf, derivePath };