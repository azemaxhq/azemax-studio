

export type FileType = 'file' | 'folder';

export interface FileNode {
    id: string;
    name: string;
    type: FileType;
    children?: FileNode[];
    content?: string; // Mock content for files
    isOpen?: boolean; // For folders (deprecated: expansion now lives in ProjectUIState.expandedFolderIds)
    parentId?: string; // Id of the parent folder ('root' for the canonical root's children)
}

export const ROOT_NODE_ID = 'root';

/**
 * Generate a globally-unique, opaque node id. Node identity is now decoupled
 * from name/path: rename/move preserve the id, so selection, active-file,
 * expansion, and bookmarks stay valid no matter how a node is reorganized.
 * Legacy path-derived ids are still accepted at the load boundary (repair),
 * but every NEW node created at runtime gets an opaque id.
 */
export function generateNodeId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') {
        return c.randomUUID();
    }
    return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The explicit no-workspace initial state: an empty tree. No project root,
 * no placeholder folders, no files. The onboarding experience renders from
 * this state, and the first created or imported node transitions the
 * workspace into existence. Nothing is persisted until the user acts.
 */
export const initialFileTree: FileNode[] = [];
