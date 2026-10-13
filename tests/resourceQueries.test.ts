/**
 * Tests for filesystem read queries (src/core/filesystem/queries.ts):
 * strict path normalization, traversal rejection, and resource resolution.
 *
 * Run with: npx tsx tests/resourceQueries.test.ts
 */
import { check, finish } from './_harness';
import {
    normalizeResourcePath,
    resolveResource,
    listDirectory,
    readFileContent,
    getResourceMetadata,
} from '../src/core/filesystem/queries';
import { createFile, createFolder } from '../src/core/filesystem/operations';
import type { FileNode } from '../src/utils/mockFileSystem';

// Build: my-app/{src/app.ts, readme.md} + top-level notes.txt
let tree: FileNode[] = [];
tree = createFolder(tree, { name: 'my-app' }).tree;
const appId = tree.find((n) => n.name === 'my-app')!.id;
const srcRes = createFolder(tree, { name: 'src', parentId: appId });
tree = srcRes.tree;
const srcId = srcRes.node!.id;
tree = createFile(tree, { name: 'app.ts', parentId: srcId, content: 'const a = 1;' }).tree;
tree = createFile(tree, { name: 'readme.md', parentId: appId, content: '# hi' }).tree;
tree = createFile(tree, { name: 'notes.txt', content: 'top' }).tree;

// Normalization.
check('plain relative path passes', normalizeResourcePath('my-app/src/app.ts').ok);
check('leading slash and ~/ accepted', normalizeResourcePath('/my-app').ok && normalizeResourcePath('~/my-app').ok);
check('dot segments dropped', normalizeResourcePath('my-app/./src/app.ts').ok);
check('dot-dot rejected (no clamping)', !normalizeResourcePath('my-app/../etc').ok);
check('absolute escape rejected', !normalizeResourcePath('/../secret').ok);
check('backslash traversal rejected', !normalizeResourcePath('my-app\\..\\x').ok);
check('control chars rejected', !normalizeResourcePath('my-app/\u0001x').ok);
check('over-long paths rejected', !normalizeResourcePath(`my-app/${'a'.repeat(600)}`).ok);
check('empty rejected unless allowed', !normalizeResourcePath('').ok && normalizeResourcePath('', { allowEmpty: true }).ok);
check('non-string rejected', !normalizeResourcePath(undefined).ok);

// Resolution.
check('nested file resolves by path', resolveResource(tree, 'my-app/src/app.ts')?.name === 'app.ts');
check('leading-slash path resolves', resolveResource(tree, '/my-app/readme.md')?.name === 'readme.md');
check('traversal attempt resolves to nothing', resolveResource(tree, 'my-app/../../notes.txt') === null);
check('missing path resolves to nothing', resolveResource(tree, 'my-app/nope.ts') === null);
check('bare-name fallback finds nested files', resolveResource(tree, 'app.ts', { fallbackNameMatch: true })?.name === 'app.ts');
check('no fallback without opt-in', resolveResource(tree, 'app.ts') === null);

// Directory listing.
const rootNames = listDirectory(tree, '').map((n) => n.name).sort();
check('root lists top-level siblings only', rootNames.join(',') === 'my-app,notes.txt');
check('folder lists children', listDirectory(tree, 'my-app/src').map((n) => n.name).join(',') === 'app.ts');
check('file/missing/traversal list nothing', listDirectory(tree, 'notes.txt').length === 0 && listDirectory(tree, 'nope').length === 0 && listDirectory(tree, '..').length === 0);

// Content + metadata.
check('file content reads by path', readFileContent(tree, 'my-app/src/app.ts') === 'const a = 1;');
check('directory read returns null', readFileContent(tree, 'my-app/src') === null);
const meta = getResourceMetadata(tree, 'my-app/src/app.ts');
check('metadata carries stable id + derived path', !!meta && meta.name === 'app.ts' && meta.path === 'my-app/src/app.ts' && meta.type === 'file' && meta.size === 12);
check('metadata resolves by stable id too', getResourceMetadata(tree, meta!.id)?.path === 'my-app/src/app.ts');
const dirMeta = getResourceMetadata(tree, 'my-app');
check('folder metadata reports children', !!dirMeta && dirMeta.type === 'folder' && dirMeta.childCount === 2);
check('synthetic root has no metadata', getResourceMetadata(tree, 'root') === null);

finish('resourceQueries');
