/**
 * Canonical filesystem data-model types.
 *
 * The Explorer filesystem is a rooted tree of FileNodes. Every mutation in the
 * application must flow through `src/core/filesystem/operations.ts`; nothing
 * else may push/splice/assign node.children. This module defines the shared
 * result/error contracts used by that layer.
 */

import type { FileNode } from '../../utils/mockFileSystem';

/** Error codes produced by the canonical operation layer. */
export type TreeErrorCode =
    | 'parent-not-found'
    | 'parent-not-folder'
    | 'target-not-folder'
    | 'node-not-found'
    | 'invalid-name'
    | 'duplicate-name'
    | 'self-move'
    | 'move-into-descendant'
    | 'invalid-state'
    | 'depth-limit'
    | 'root-immutable'
    | 'invalid-input';

export interface TreeError {
    code: TreeErrorCode;
    message: string;
}

/**
 * Result of every canonical filesystem mutation.
 *
 * - `tree` is the new tree (=== input when `changed` is false).
 * - `changed` is true when a mutation was committed.
 * - `error` is set when the operation was rejected; `changed` is false then.
 * - `node` is the created/updated node for create/update operations.
 * - `remap` maps OLD ids → NEW ids for any node whose id was re-derived
 *   (rename / move), so callers can keep selection / active-file consistent.
 */
export interface TreeOperationResult {
    tree: FileNode[];
    changed: boolean;
    error?: TreeError;
    node?: FileNode;
    remap?: ReadonlyMap<string, string>;
}

/** Input descriptor for creating a file or folder. */
export interface CreateNodeInput {
    /** Name of the new node (file/folder name, not a path). */
    name: string;
    /** Id of the parent folder. `ROOT_NODE_ID` targets the project root. */
    parentId?: string;
    /** Initial content for files. */
    content?: string;
}

/** Returns a failed result for the input tree (unchanged). */
export function failureResult(
    tree: FileNode[],
    code: TreeErrorCode,
    message: string,
): TreeOperationResult {
    return { tree, changed: false, error: { code, message } };
}

/** Returns a successful (unchanged) no-op result. */
export function noopResult(tree: FileNode[], remap?: ReadonlyMap<string, string>): TreeOperationResult {
    return { tree, changed: false, remap };
}