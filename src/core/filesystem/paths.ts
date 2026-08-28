/**
 * Path derivation helpers.
 *
 * Node ids are deterministic path strings (`src/components/Button.tsx`), which
 * keeps every existing consumer (AI paths, terminal navigation, "Copy Path")
 * working while giving each node a stable identity. These helpers centralize
 * the single derivation rule so rename/move re-derive ids consistently.
 */

import { ROOT_NODE_ID } from '../../utils/mockFileSystem';

/** Parent id of a path-based node id. The root's direct children return 'root'. */
export function parentIdOf(id: string): string {
    const idx = id.lastIndexOf('/');
    return idx === -1 ? ROOT_NODE_ID : id.substring(0, idx);
}

/** Last path segment (the node's own name) of a path-based id. */
export function nameOf(id: string): string {
    const idx = id.lastIndexOf('/');
    return idx === -1 ? id : id.substring(idx + 1);
}

/** Derive the path id for a child of `parentId` named `name`. */
export function derivePath(parentId: string, name: string): string {
    return parentId === ROOT_NODE_ID ? name : `${parentId}/${name}`;
}

/**
 * Whether `descendantId` could live under `ancestorId` purely by path prefix.
 * NOTE: this is a cheap string check only — use it for id generation guards,
 * not as a substitute for `isDescendantOf` (which walks the real tree).
 */
export function isPathBelow(ancestorId: string, descendantId: string): boolean {
    return descendantId === ancestorId || descendantId.startsWith(ancestorId + '/');
}

/** Root's canonical node id. */
export { ROOT_NODE_ID };