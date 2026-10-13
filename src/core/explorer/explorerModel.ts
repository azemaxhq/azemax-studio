/**
 * Explorer tree model — presentation data source for the file Explorer.
 *
 * VS Code reference (verified in vscode-main):
 * - `src/vs/workbench/contrib/files/common/explorerModel.ts`: `ExplorerItem`
 *   (resource identity, parent/children, resolved flags) + `ExplorerModel`
 *   (roots per workspace folder). The model never touches the DOM.
 * - `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`:
 *   `ExplorerDataSource` (async children), `FilesFilter`, `FileSorter`,
 *   `identityProvider.getId()` — data, filter, sort, and rendering are
 *   separate pluggable pieces around the tree.
 * - `src/vs/workbench/contrib/files/browser/views/emptyView.ts`: the empty
 *   workspace is its own view, not an empty tree node.
 *
 * Azemax adaptation: the filesystem (`core/filesystem`) stays the single
 * mutation layer; this module owns the Explorer's *view* of that data —
 * placeholder suppression, the render forest projection, and empty-state
 * discrimination. It is pure (no React, no DOM) and fully unit-tested.
 * Sorting/filtering themselves stay where they are (`explorerSort`,
 * `safeTree.filterTree`); this module consumes their outputs.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { PLACEHOLDER_ROOT_NAME } from '../filesystem/paths';

/** The legacy generated placeholder root. Never a project, never an identity. */
export { PLACEHOLDER_ROOT_NAME };

/** True when the node is the legacy generated placeholder container. */
export function isPlaceholderRoot(node: Pick<FileNode, 'id' | 'name'> | null | undefined): boolean {
    return !!node && node.id === ROOT_NODE_ID && node.name === PLACEHOLDER_ROOT_NAME;
}

/**
 * Project the (already sorted + filtered) top-level tree into the render
 * forest — the exact nodes the Explorer must draw.
 *
 * Rules (all render-only; the real tree is never mutated):
 * 1. Real content lives as top-level SIBLINGS of the synthetic root. With no
 *    siblings there is no project, so a lone root container (placeholder or
 *    otherwise) never renders — the empty-workspace UI renders instead.
 * 2. A persisted placeholder container alongside real content is not a
 *    project: render the real siblings directly instead of nesting them
 *    under a phantom folder.
 * 3. Any other root container keeps the legacy wrap (its provenance is
 *    unconfirmed, so presentation is conservative).
 */
export function buildRenderForest(sortedNodes: readonly FileNode[]): FileNode[] {
    const siblings = sortedNodes.filter((n) => n.id !== ROOT_NODE_ID);
    if (siblings.length === 0) return [];
    const root = sortedNodes.find((n) => n.id === ROOT_NODE_ID);
    if (!root) return [...siblings];
    if (isPlaceholderRoot(root)) return [...siblings];
    return [{ ...root, children: [...siblings] }];
}

export type ExplorerEmptyState =
    | 'ready'
    | 'no-workspace'
    | 'no-results';

/**
 * Discriminate the Explorer's empty states (Phase 7E):
 * - `no-workspace`: no renderable rows and no active search — onboarding /
 *   "no files yet" UI. Never a fabricated root folder.
 * - `no-results`: a search is active and matched nothing.
 * - `ready`: there are rows to draw (per-row empty folders render their own
 *   inline "Empty folder" state inside the row component).
 */
export function resolveExplorerEmptyState(input: {
    rowCount: number;
    searchQuery: string;
}): ExplorerEmptyState {
    if (input.rowCount > 0) return 'ready';
    return input.searchQuery.trim() ? 'no-results' : 'no-workspace';
}
