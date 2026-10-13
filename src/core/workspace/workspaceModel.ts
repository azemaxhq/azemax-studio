/**
 * Workspace model — identity + lifecycle for the Azemax workspace.
 *
 * VS Code reference (verified in vscode-main):
 * - `src/vs/platform/workspace/common/workspace.ts`: `Workspace { id, folders,
 *   transient?, configuration?, name? }`, `WorkspaceFolder { uri, name, index,
 *   toResource() }`, `WorkbenchState { EMPTY, FOLDER, WORKSPACE }`. URI is the
 *   identity; the display name is derived and overridable.
 * - `src/vs/workbench/contrib/files/browser/views/emptyView.ts`: the empty
 *   workspace renders a dedicated view, never a fabricated folder.
 *
 * Azemax adaptation (single-root web IDE — multi-root, configuration-backed
 * workspaces and the label service are deliberately out of scope):
 * - Exactly one workspace is active at a time. Its identity is a stable opaque
 *   id persisted per user namespace; the display name is derived from the
 *   actual top-level content and never hardcoded.
 * - Lifecycle is an explicit state machine. In particular `restoring` (storage
 *   is being read) is distinct from `no-workspace` (storage was read and holds
 *   no project), so the UI can never mistake "not loaded yet" for "empty".
 */

export type WorkspaceStatus =
    | 'uninitialized'
    | 'restoring'
    | 'no-workspace'
    | 'loading'
    | 'ready'
    | 'creating'
    | 'importing'
    | 'error';

/** How the active workspace came into existence (provenance, Phase 11). */
export type WorkspaceOrigin =
    | 'unknown'
    | 'restored'
    | 'blank'
    | 'template'
    | 'import';

export interface WorkspaceMetadata {
    /** Stable opaque identity, independent of the display name. */
    id: string;
    /** Actual project name (top-level content), never a fallback constant. */
    displayName: string | null;
    origin: WorkspaceOrigin;
    /** Epoch ms when the workspace record was first created. */
    createdAt: number;
    /** Epoch ms of the last observed tree mutation. */
    updatedAt: number;
}

export interface WorkspaceState {
    status: WorkspaceStatus;
    metadata: WorkspaceMetadata | null;
    error: string | null;
}

export const INITIAL_WORKSPACE_STATE: WorkspaceState = {
    status: 'uninitialized',
    metadata: null,
    error: null,
};

/** True when a real workspace is open (creation/import in progress counts). */
export function isWorkspaceActive(status: WorkspaceStatus): boolean {
    return status === 'ready' || status === 'creating' || status === 'importing' || status === 'loading';
}

export function generateWorkspaceId(): string {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkspaceMetadata(
    displayName: string | null,
    origin: WorkspaceOrigin,
    previous: WorkspaceMetadata | null,
    now: number = Date.now(),
): WorkspaceMetadata {
    if (previous) {
        return {
            ...previous,
            displayName,
            origin: previous.origin === 'unknown' && origin !== 'unknown' ? origin : previous.origin,
            updatedAt: now,
        };
    }
    return { id: generateWorkspaceId(), displayName, origin, createdAt: now, updatedAt: now };
}

export interface StatusInputs {
    initialized: boolean;
    restoring: boolean;
    busy: 'creating' | 'importing' | null;
    hasProject: boolean;
    error: string | null;
}

/**
 * Single place that maps runtime signals to a lifecycle status.
 * Priority: error > restoring/uninitialized > busy > project presence.
 * Awaiting storage is never reported as `no-workspace`.
 */
export function deriveWorkspaceStatus(inputs: StatusInputs): WorkspaceStatus {
    if (inputs.error) return 'error';
    if (inputs.restoring || !inputs.initialized) return 'restoring';
    if (inputs.busy === 'creating') return 'creating';
    if (inputs.busy === 'importing') return 'importing';
    return inputs.hasProject ? 'ready' : 'no-workspace';
}
