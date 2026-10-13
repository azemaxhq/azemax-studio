/**
 * Canonical filesystem module.
 *
 * Everything that reads or mutates the project file tree should import from
 * here. The module enforces the "tree is always a valid rooted DAG" invariant
 * at every operation boundary.
 */

export * from './types';
export * from './paths';
export {
    validateFileTree,
    assertValidFileTree,
    repairFileTree,
} from './validate';
export type { ValidationResult, ValidationIssue, RepairResult } from './validate';
export {
    createFile,
    createFolder,
    ensureFolderPath,
    renameNode,
    moveNode,
    copyNode,
    duplicateNode,
    deleteNode,
    updateFileContent,
    toggleFolderExpansion,
    collectFolderIds,
} from './operations';
export {
    normalizeResourcePath,
    resolveResource,
    listDirectory,
    readFileContent,
    getResourceMetadata,
    MAX_RESOURCE_PATH_LENGTH,
} from './queries';
export type { NormalizeResult, ResolveOptions, ResourceMetadata } from './queries';
export {
    subscribeFileChanges,
    emitFileChange,
    requestExplorerRefresh,
    subscribeExplorerRefresh,
} from './fileChangeService';
export type { FileChangeKind, FileChangeEvent, FileChangeListener, RefreshListener } from './fileChangeService';