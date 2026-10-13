/**
 * Tests for the Explorer tree model (src/core/explorer/explorerModel.ts):
 * placeholder suppression, the render-forest projection, and empty-state
 * discrimination. No React, no DOM — pure data rules.
 *
 * Run with: npx tsx tests/explorerModel.test.ts
 */
import { check, finish } from './_harness';
import {
    buildRenderForest,
    resolveExplorerEmptyState,
    isPlaceholderRoot,
    PLACEHOLDER_ROOT_NAME,
} from '../src/core/explorer/explorerModel';
import { ROOT_NODE_ID, generateNodeId, type FileNode } from '../src/utils/mockFileSystem';

check('placeholder constant is the legacy default name', PLACEHOLDER_ROOT_NAME === 'deep-context-ide');

const placeholder: FileNode = { id: ROOT_NODE_ID, name: 'deep-context-ide', type: 'folder', parentId: undefined, children: [] };
const otherRoot: FileNode = { id: ROOT_NODE_ID, name: 'My Project', type: 'folder', parentId: undefined, children: [] };
const app = (): FileNode => ({ id: generateNodeId(), name: 'my-app', type: 'folder', parentId: ROOT_NODE_ID, children: [] });
const file = (): FileNode => ({ id: generateNodeId(), name: 'a.ts', type: 'file', parentId: ROOT_NODE_ID, content: 'x' });

check('placeholder root detected', isPlaceholderRoot(placeholder));
check('other root is not the placeholder', !isPlaceholderRoot(otherRoot));
check('null-safe predicate', !isPlaceholderRoot(null) && !isPlaceholderRoot(undefined));

// Projection rules.
check('empty tree renders nothing', buildRenderForest([]).length === 0);
check('lone placeholder root never renders (no-workspace, not a project)', buildRenderForest([placeholder]).length === 0);
check('lone foreign root never renders as a project either', buildRenderForest([otherRoot]).length === 0);
const solo = app();
check('single real project renders directly', buildRenderForest([solo]).length === 1 && buildRenderForest([solo])[0].name === 'my-app');
const withPh = buildRenderForest([placeholder, app()]);
check('placeholder alongside content is dropped, siblings render flat', withPh.length === 1 && withPh[0].name === 'my-app' && withPh.every((n) => n.id !== ROOT_NODE_ID));
const wrapped = buildRenderForest([otherRoot, app()]);
check('non-placeholder root keeps the legacy wrap', wrapped.length === 1 && wrapped[0].id === ROOT_NODE_ID && (wrapped[0].children ?? []).length === 1);
const f = file();
const multi = buildRenderForest([f, app()]);
check('rootless siblings render as-is', multi.length === 2);

// The projection must not mutate its input.
const input = [placeholder, app()];
const snapshot = JSON.stringify(input);
buildRenderForest(input);
check('projection is pure (input untouched)', JSON.stringify(input) === snapshot);

// Empty-state discrimination.
check('rows present -> ready', resolveExplorerEmptyState({ rowCount: 3, searchQuery: '' }) === 'ready');
check('no rows, no search -> no-workspace', resolveExplorerEmptyState({ rowCount: 0, searchQuery: '' }) === 'no-workspace');
check('no rows with search -> no-results', resolveExplorerEmptyState({ rowCount: 0, searchQuery: 'foo' }) === 'no-results');
check('whitespace search counts as no search', resolveExplorerEmptyState({ rowCount: 0, searchQuery: '   ' }) === 'no-workspace');

finish('explorerModel');
