/**
 * File change service — typed change fan-out for the virtual filesystem.
 *
 * VS Code reference (verified in vscode-main):
 * - `src/vs/platform/files/common/files.ts`: `FileChangeType { UPDATED, ADDED,
 *   DELETED }`, `IFileChange`, `FileChangesEvent`, `FileOperation { CREATE,
 *   DELETE, MOVE, COPY, WRITE }` + `onDidRunOperation`.
 * - `src/vs/platform/files/common/inMemoryFilesystemProvider.ts`: `_fireSoon`
 *   buffers changes and coalesces them on a short timer before firing.
 * - `src/vs/workbench/contrib/files/browser/explorerService.ts`:
 *   `onFileChangesScheduler` debounces external events (`..._REACT_DELAY=500`).
 *
 * Azemax adaptation: localStorage provides no native file watching, so this
 * bus carries authoritative in-app mutations (every `core/filesystem`
 * operation applied through `ProjectContext`) plus explicit refresh requests.
 * Listeners are module-level (no React required), each invoked defensively so
 * one failing subscriber never breaks the others. Subscriptions return a
 * dispose function; callers must dispose on unmount (no per-row global
 * subscriptions — subscribe at view level and fan out via state).
 */

export type FileChangeKind = 'created' | 'updated' | 'renamed' | 'moved' | 'deleted';

export interface FileChangeEvent {
    kind: FileChangeKind;
    /** Stable opaque node id (never a display name). */
    id: string;
    name: string;
    parentId?: string;
    prevParentId?: string;
    prevName?: string;
    /** Workspace-relative path at event time, when cheap to compute. */
    path?: string;
}

export type FileChangeListener = (event: FileChangeEvent) => void;
export type RefreshListener = (reason: string) => void;

const changeListeners = new Set<FileChangeListener>();
const refreshListeners = new Set<RefreshListener>();

/** Subscribe to file change events. Returns a dispose function. */
export function subscribeFileChanges(listener: FileChangeListener): () => void {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
}

/** Publish a file change event to all subscribers (defensive dispatch). */
export function emitFileChange(event: FileChangeEvent): void {
    for (const listener of Array.from(changeListeners)) {
        try {
            listener(event);
        } catch (e) {
            console.warn('[FileChangeService] Listener failed:', e);
        }
    }
}

/** Request an Explorer refresh (typed replacement for stringly-typed events). */
export function requestExplorerRefresh(reason = 'manual'): void {
    for (const listener of Array.from(refreshListeners)) {
        try {
            listener(reason);
        } catch (e) {
            console.warn('[FileChangeService] Refresh listener failed:', e);
        }
    }
}

/** Subscribe to Explorer refresh requests. Returns a dispose function. */
export function subscribeExplorerRefresh(listener: RefreshListener): () => void {
    refreshListeners.add(listener);
    return () => {
        refreshListeners.delete(listener);
    };
}

/** Test/StrictMode helper: how many listeners are currently registered. */
export function fileChangeListenerCount(): { changes: number; refresh: number } {
    return { changes: changeListeners.size, refresh: refreshListeners.size };
}
