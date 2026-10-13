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

/** Root's canonical node id. */
export { ROOT_NODE_ID };

/**
 * Legacy default project name materialized by the pre-empty-state
 * `initialFileTree` fallback. Single source of truth: repair (validate.ts)
 * and presentation (explorerModel.ts) both key provenance off this constant.
 * Never use it as a fallback display name for a missing workspace.
 */
export const PLACEHOLDER_ROOT_NAME = 'deep-context-ide';