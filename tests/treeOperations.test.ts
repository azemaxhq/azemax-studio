/**
 * Regression tests for the canonical filesystem layer (src/core/filesystem).
 *
 * Covers the recursion / duplicate-id bug class (batched creates used to nest
 * identical folders hundreds of levels deep), the opaque-id architecture
 * (identity decoupled from name/path), derived paths, terminal consistency,
 * deterministic repair, persistence round-trips, and 10k-node performance.
 *
 * Run with: npx tsx tests/treeOperations.test.ts
 */
import { check, finish } from './_harness';
import {
    createFile,
    createFolder,
    ensureFolderPath,
    renameNode,
    moveNode,
    copyNode,
    duplicateNode,
    deleteNode,
    updateFileContent,
    collectFolderIds,
} from '../src/core/filesystem';
import { repairFileTree, validateFileTree, assertValidFileTree } from '../src/core/filesystem';
import { ROOT_NODE_ID, generateNodeId, type FileNode } from '../src/utils/mockFileSystem';
import {
    findNode,
    findNodeById,
    findChildByName,
    pathOf,
    resolvePath,
    sortTree,
} from '../src/utils/safeTree';

const ROOT = ROOT_NODE_ID;

/** Build a canonical sibling-model tree (root only; siblings added via ops). */
const mkTree = (siblings: FileNode[] = []): FileNode[] => [
    { id: ROOT, name: 'deep-context-ide', type: 'folder', parentId: undefined, children: [] },
    ...siblings,
];

/** Raw test node with an opaque id (avoids path-derived assumptions). */
const mkFolder = (parentId: string, name: string, children: FileNode[] = []): FileNode => ({
    id: generateNodeId(),
    name,
    type: 'folder',
    parentId,
    children,
});

const mkFile = (parentId: string, name: string, content = ''): FileNode => ({
    id: generateNodeId(),
    name,
    type: 'file',
    parentId,
    ...(content ? { content } : {}),
});

// ============================================================================
// A. Canonical root / sibling model — root is a CONTAINER, never a child
// ============================================================================
{
    const tree = mkTree();
    assertValidFileTree(tree);
    check('A: fresh root is valid', validateFileTree(tree).valid);
    check('A: exactly one root', validateFileTree(tree).issues.every(i => !i.message.includes('canonical root')));

    const tree2 = mkTree();
    const readme = createFile(tree2, { name: 'readme.md', parentId: ROOT, content: 'x' });
    const src = createFolder(readme.tree, { name: 'src', parentId: ROOT });
    const inner = createFile(src.tree, { name: 'a.ts', parentId: src.node!.id, content: 'x' });
    check('A: sibling model with content is valid', validateFileTree(inner.tree).valid);
    check('A: root.children stays empty', (inner.tree[0].children ?? []).length === 0);
    check('A: nested file parentId consistent', findNodeById(inner.tree, inner.node!.id)?.parentId === src.node!.id);
}

// ============================================================================
// B. Opaque ids — identity is decoupled from name/path
// ============================================================================
{
    const tree = mkTree();
    const f = createFolder(tree, { name: 'src', parentId: ROOT });
    check('B: new folder gets an opaque id (not its name)', !!f.node?.id && f.node.id !== 'src' && f.node.id !== ROOT);
    check('B: new folder id is a non-empty string', typeof f.node?.id === 'string' && (f.node?.id ?? '').length > 0);
    check('B: folder parentId points at the canonical root', f.node?.parentId === ROOT);

    const tree2 = mkTree();
    const file = createFile(tree2, { name: 'a.ts', parentId: ROOT, content: 'x' });
    check('B: new file gets an opaque id', !!file.node?.id && file.node.id !== 'a.ts');
    check('B: file parentId is root', file.node?.parentId === ROOT);

    // Two different names never collide in id space.
    let t = mkTree();
    t = createFile(t, { name: 'a.ts', parentId: ROOT }).tree;
    t = createFile(t, { name: 'b.ts', parentId: ROOT }).tree;
    const ids = t.filter(n => n.id !== ROOT).map(n => n.id);
    check('B: distinct files get distinct opaque ids', new Set(ids).size === ids.length);
}

// ============================================================================
// C. THE RECURSION BUG — repeated "deep-context-ide" creates must NOT nest
// ============================================================================
{
    let tree = mkTree();
    const proj = createFolder(tree, { name: 'deep-context-ide', parentId: ROOT });
    check('C: project folder created', proj.changed && proj.node?.name === 'deep-context-ide');
    tree = proj.tree;
    assertValidFileTree(tree);

    // Mimic the stale-state batch that historically nested it hundreds deep.
    const created: string[] = ['deep-context-ide'];
    for (let i = 0; i < 5; i++) {
        const res = createFolder(tree, { name: 'deep-context-ide', parentId: ROOT });
        check(`C: repeat #${i + 1} succeeds`, res.changed);
        tree = res.tree;
        created.push(res.node?.name ?? '');
    }

    assertValidFileTree(tree);
    const top = tree.filter(n => n.id !== ROOT);
    check('C: all repeats are top-level siblings', top.length === 6);
    check('C: no sibling is nested under another', top.every(n => n.parentId === ROOT));
    check('C: root is never its own child', (tree[0].children ?? []).length === 0);
    check(
        'C: names are unique (root name collision avoided)',
        new Set(top.map(n => n.name)).size === 6,
    );
    check('C: no duplicate ids', new Set(tree.map(n => n.id)).size === tree.length);
}

// ============================================================================
// D. Same-tick batched creates (stale-state duplicate-id reproduction)
// ============================================================================
{
    let t = mkTree();
    for (let i = 0; i < 3; i++) {
        t = createFolder(t, { name: 'deep-context-ide', parentId: ROOT }).tree;
    }
    const ids = t.filter(n => n.id !== ROOT).map(n => n.id);
    check('D: three batched creates give unique ids', new Set(ids).size === 3);
    assertValidFileTree(t);
}

// ============================================================================
// E. mkdir -p / auto-ensure parents by NAME (opaque ids)
// ============================================================================
{
    let tree = mkTree();
    const ensured = ensureFolderPath(tree, 'src/components');
    tree = ensured.tree;
    check('E: ensureFolderPath created parents', ensured.changed);
    check('E: deepest node returned with an opaque id', !!ensured.node && ensured.node.id !== 'src/components' && ensured.node.name === 'components');

    const res = createFile(tree, { name: 'app.js', parentId: ensured.node?.id ?? ROOT, content: 'x' });
    check('E: createFile into ensured dir succeeds', res.changed && res.node?.parentId === ensured.node?.id);
    tree = res.tree;
    assertValidFileTree(tree);

    check('E: derived path of nested file is correct', pathOf(tree, res.node?.id ?? '') === 'src/components/app.js');
    check('E: parentId chain resolves through opaque ids', findNodeById(tree, res.node?.parentId ?? '')?.name === 'components');

    const again = ensureFolderPath(tree, 'src/components');
    check('E: ensureFolderPath is idempotent', again.changed === false);
}

/** Id of the (unique) node whose derived path equals `p`, else ''. */
function pathToId(tree: FileNode[], p: string): string {
    return findNode(tree, n => pathOf(tree, n.id) === p)?.id ?? '';
}

// ============================================================================
// F. Duplicate names are auto-suffixed, never overwritten
// ============================================================================
{
    let tree = mkTree();
    tree = createFile(tree, { name: 'index.ts', parentId: ROOT, content: 'a' }).tree;
    const second = createFile(tree, { name: 'index.ts', parentId: ROOT, content: 'b' });
    check('F: duplicate file gets unique name', second.changed && second.node?.name === 'index (1).ts');
    check('F: suffixed duplicate still gets a fresh opaque id', second.node?.id !== second.node?.name);
    assertValidFileTree(second.tree);
}

// ============================================================================
// G. Rename PRESERVES identity (the bug was delete+recreate with new ids)
// ============================================================================
{
    let tree = mkTree();
    const srcRes = createFolder(tree, { name: 'old', parentId: ROOT });
    tree = srcRes.tree;
    const oldId = srcRes.node!.id;
    const fileRes = createFile(tree, { name: 'a.ts', parentId: oldId, content: 'x' });
    tree = fileRes.tree;
    const childId = fileRes.node!.id;

    const res = renameNode(tree, oldId, 'renamed');
    check('G: rename succeeds', res.changed);
    check('G: renamed node id is UNCHANGED', !!findNodeById(res.tree, oldId));
    check('G: renamed node name updated', findNodeById(res.tree, oldId)?.name === 'renamed');
    check('G: descendant id is UNCHANGED', !!findNodeById(res.tree, childId));
    check('G: descendant parentId still points at the folder', findNodeById(res.tree, childId)?.parentId === oldId);
    check('G: no remap produced (ids are stable)', res.remap === undefined || res.remap.size === 0);
    assertValidFileTree(res.tree);

    // Collision -> auto-suffix, still identity-preserving.
    let tree2 = mkTree();
    tree2 = createFolder(tree2, { name: 'a', parentId: ROOT }).tree;
    const bRes = createFolder(tree2, { name: 'b', parentId: ROOT });
    tree2 = bRes.tree;
    const bId = bRes.node!.id;
    const collide = renameNode(tree2, bId, 'a');
    check('G: colliding rename auto-suffixed', collide.changed && findNodeById(collide.tree, bId)?.name === 'a (1)');
    check('G: colliding rename keeps the same id', !!findNodeById(collide.tree, bId));
    assertValidFileTree(collide.tree);
}

// ============================================================================
// H. Move PRESERVES identity
// ============================================================================
{
    let tree = mkTree();
    const folderRes = createFolder(tree, { name: 'moved', parentId: ROOT });
    tree = folderRes.tree;
    const movedId = folderRes.node!.id;
    const fileRes = createFile(tree, { name: 'inner.ts', parentId: movedId, content: 'x' });
    tree = fileRes.tree;
    const innerId = fileRes.node!.id;
    const destRes = createFolder(tree, { name: 'dest', parentId: ROOT });
    tree = destRes.tree;
    const destId = destRes.node!.id;

    const res = moveNode(tree, movedId, destId);
    check('H: move succeeds', res.changed);
    check('H: moved node keeps its id', !!findNodeById(res.tree, movedId));
    check('H: moved node parentId updated', findNodeById(res.tree, movedId)?.parentId === destId);
    check('H: descendant keeps its id', !!findNodeById(res.tree, innerId));
    check('H: descendant parentId still the moved folder', findNodeById(res.tree, innerId)?.parentId === movedId);
    check('H: derived path reflects the new location', pathOf(res.tree, innerId) === 'dest/moved/inner.ts');
    assertValidFileTree(res.tree);

    // Move to root.
    const back = moveNode(res.tree, movedId, ROOT);
    check('H: move to root works', back.changed && findNodeById(back.tree, movedId)?.parentId === ROOT);
    assertValidFileTree(back.tree);
}

// ============================================================================
// I. Root immutability + invalid moves
// ============================================================================
{
    let tree = mkTree();
    const srcRes = createFolder(tree, { name: 'src', parentId: ROOT });
    tree = srcRes.tree;
    const srcId = srcRes.node!.id;
    const fileRes = createFile(tree, { name: 'a.ts', parentId: srcId });
    tree = fileRes.tree;
    const fileId = fileRes.node!.id;

    check('I: rename root rejected', renameNode(tree, ROOT, 'x').error?.code === 'root-immutable');
    check('I: move root rejected', moveNode(tree, ROOT, srcId).error?.code === 'root-immutable');
    check('I: delete root rejected', deleteNode(tree, ROOT).error?.code === 'root-immutable');
    check('I: move self rejected', moveNode(tree, srcId, srcId).error?.code === 'self-move');
    check('I: move into descendant rejected', moveNode(tree, srcId, fileId).error?.code === 'move-into-descendant');
    check('I: move file into itself rejected', moveNode(tree, fileId, fileId).error?.code === 'self-move');
    check('I: move into a file rejected', moveNode(tree, srcId, fileId).error?.code === 'move-into-descendant');
}

// ============================================================================
// J. delete / duplicate / copy — fresh ids for clones, subtree removal for delete
// ============================================================================
{
    let tree = mkTree();
    const srcRes = createFolder(tree, { name: 'src', parentId: ROOT });
    tree = srcRes.tree;
    const srcId = srcRes.node!.id;
    const fileRes = createFile(tree, { name: 'a.ts', parentId: srcId, content: 'x' });
    tree = fileRes.tree;
    const childId = fileRes.node!.id;

    const del = deleteNode(tree, srcId);
    check('J: delete removes subtree', del.changed && !findNodeById(del.tree, srcId) && !findNodeById(del.tree, childId));
    assertValidFileTree(del.tree);
    check('J: delete missing node is a no-op', deleteNode(tree, generateNodeId()).changed === false);

    // Duplicate -> fresh ids everywhere, unique name.
    const dup = duplicateNode(tree, srcId);
    const dupRoot = dup.tree.find(n => n.id !== ROOT && n.name === 'src (1)');
    check('J: duplicate creates sibling copy', dup.changed && !!dupRoot);
    check('J: duplicate gets a NEW id', !!dupRoot && dupRoot.id !== srcId);
    const dupChild = dupRoot?.children?.[0];
    check('J: duplicated subtree gets fresh ids', !!dupChild && dupChild.id !== childId && dupChild.parentId === dupRoot?.id);
    assertValidFileTree(dup.tree);

    // Copy into another folder.
    let tree2 = mkTree();
    const aRes = createFolder(tree2, { name: 'src', parentId: ROOT });
    tree2 = aRes.tree;
    const aId = aRes.node!.id;
    const dRes = createFolder(tree2, { name: 'dest', parentId: ROOT });
    tree2 = dRes.tree;
    const dId = dRes.node!.id;
    const copy = copyNode(tree2, aId, dId);
    const copied = findNodeById(copy.tree, dId)?.children?.[0];
    check('J: copy into folder works', copy.changed && !!copied && copied.id !== aId);
    check('J: copy parentId is the target folder', copied?.parentId === dId);
    assertValidFileTree(copy.tree);

    // Copy into descendant rejected.
    const innerRes = createFolder(tree2, { name: 'inner', parentId: aId });
    tree2 = innerRes.tree;
    check('J: copy into descendant rejected', copyNode(tree2, aId, innerRes.node!.id).error?.code === 'move-into-descendant');
}

// ============================================================================
// K. updateFileContent
// ============================================================================
{
    let tree = mkTree();
    const f = createFile(tree, { name: 'a.ts', parentId: ROOT, content: 'one' });
    tree = f.tree;
    const id = f.node!.id;
    const upd = updateFileContent(tree, id, 'two');
    check('K: update returns new content', upd.changed && upd.node?.content === 'two');
    check('K: update is validated', validateFileTree(upd.tree).valid);
    const noop = updateFileContent(tree, id, 'one');
    check('K: unchanged content is a no-op', noop.changed === false);
    check('K: updating a folder rejected', updateFileContent(tree, ROOT, 'x').error !== undefined);
}

// ============================================================================
// L. Derived paths (pathOf) + name resolution (resolvePath / findChildByName)
// ============================================================================
{
    let tree = mkTree();
    tree = ensureFolderPath(tree, 'src/components').tree;
    const src = pathToId(tree, 'src');
    const components = pathToId(tree, 'src/components');
    const fileRes = createFile(tree, { name: 'app.js', parentId: components, content: 'x' });
    tree = fileRes.tree;
    const fileId = fileRes.node!.id;

    check('L: pathOf(root) is empty', pathOf(tree, ROOT) === '');
    check('L: pathOf(src) is "src"', pathOf(tree, src) === 'src');
    check('L: pathOf(components) is "src/components"', pathOf(tree, components) === 'src/components');
    check('L: pathOf(file) is "src/components/app.js"', pathOf(tree, fileId) === 'src/components/app.js');
    check('L: pathOf(missing id) is empty', pathOf(tree, generateNodeId()) === '');

    check('L: resolvePath round-trips a derived path', resolvePath(tree, 'src/components/app.js')?.id === fileId);
    check('L: resolvePath handles absolute paths', resolvePath(tree, '/src')?.id === src);
    check('L: resolvePath handles ..', resolvePath(tree, 'src/components/..')?.id === src);
    check('L: resolvePath misses unknown segments', resolvePath(tree, 'src/nope') === null);

    check('L: findChildByName under a folder by name', findChildByName(tree, components, 'app.js')?.id === fileId);
    check('L: findChildByName at root', findChildByName(tree, ROOT, 'src')?.id === src);
    check('L: findChildByName misses', findChildByName(tree, ROOT, 'nope') === null);
}

// ============================================================================
// M. IDE sorting (sortTree) — folders first, natural order, structural sharing
// ============================================================================
{
    let tree = mkTree();
    tree = createFile(tree, { name: 'z.txt', parentId: ROOT }).tree;
    tree = createFile(tree, { name: 'a.txt', parentId: ROOT }).tree;
    tree = createFile(tree, { name: 'file2.txt', parentId: ROOT }).tree;
    tree = createFile(tree, { name: 'file10.txt', parentId: ROOT }).tree;
    tree = createFolder(tree, { name: 'Folder', parentId: ROOT }).tree;
    tree = createFolder(tree, { name: 'a-folder', parentId: ROOT }).tree;

    const sorted = sortTree(tree);
    const names = sorted.filter(n => n.id !== ROOT).map(n => `${n.type}:${n.name}`);
    check('M: folders sort before files', names[0] === 'folder:a-folder' && names[1] === 'folder:Folder');
    check('M: files sort naturally (numeric-aware)', names.includes('file:file2.txt') && names.includes('file:file10.txt'));
    check('M: natural order: file10 after file2', names.indexOf('file:file2.txt') < names.indexOf('file:file10.txt'));
    check('M: root stays the top-level container', sorted[0]?.id === ROOT);
    assertValidFileTree(sorted);

    // Structural sharing: an already-sorted tree returns the SAME array/node refs.
    const sorted2 = sortTree(sorted);
    check('M: sorting a sorted tree preserves identity', sorted2 === sorted);
    const rootObj = sorted[0];
    check('M: sorted root node object preserved', sorted2[0] === rootObj);

    // Cycle-safety: sortTree must terminate on a cyclic node.
    const cyclic: FileNode = { id: generateNodeId(), name: 'c', type: 'folder', parentId: ROOT, children: [] };
    cyclic.children = [cyclic];
    const safe = sortTree([{ id: ROOT, name: 'root', type: 'folder', parentId: undefined, children: [] }, cyclic]);
    check('M: sortTree terminates on cyclic input', safe.length === 2);
}

// ============================================================================
// N. Terminal ↔ Explorer consistency (derived cwd paths)
// ============================================================================
{
    let tree = mkTree();
    tree = ensureFolderPath(tree, 'src/components').tree;
    const components = pathToId(tree, 'src/components');

    // pwd at root
    check('N: root cwd derives to "" (display "/")', pathOf(tree, ROOT) === '');
    // pwd inside src/components
    check('N: subfolder cwd derives to "src/components"', pathOf(tree, components) === 'src/components');
    // runCwd parity: root -> 'root' fallback, subfolder -> derived path
    check('N: runCwd for root is "root"', (pathOf(tree, ROOT) || 'root') === 'root');
    check('N: runCwd for subfolder is the derived path', (pathOf(tree, components) || 'root') === 'src/components');

    // `..` from a root-level item resolves back to the canonical root.
    const topFolder = pathToId(tree, 'src');
    const up = resolvePath(tree, '..');
    const topNode = findNodeById(tree, topFolder);
    check('N: parent of a root-level item is the root container', !!topNode && (topNode.parentId === ROOT));
    check('N: resolvePath("..") from root stays root', up?.id === ROOT);
}

// ============================================================================
// O. Repair — preserve valid ids; deterministic repair of invalid ones
// ============================================================================
{
    // 1) Opaque ids are preserved verbatim (active-file/bookmark continuity).
    let tree = mkTree();
    tree = ensureFolderPath(tree, 'src/components').tree;
    const fileRes = createFile(tree, { name: 'app.js', parentId: pathToId(tree, 'src/components') });
    tree = fileRes.tree;
    const fileId = fileRes.node!.id;
    const roundTrip = repairFileTree(JSON.parse(JSON.stringify(tree)));
    check('O: opaque ids survive a persistence round-trip', !!findNodeById(roundTrip.tree, fileId));
    check('O: round-trip of an already-valid tree is NOT a repair', roundTrip.repaired === false);
    assertValidFileTree(roundTrip.tree);

    // 2) Legacy path ids are preserved too.
    const legacy = [{
        id: ROOT, name: 'deep-context-ide', type: 'folder', isOpen: true,
        children: [
            { id: 'root/a.ts', name: 'a.ts', type: 'file', content: 'x' },
            { id: 'root/src', name: 'src', type: 'folder', isOpen: true, children: [] },
        ],
    }];
    const migrated = repairFileTree(legacy);
    check('O: legacy path ids preserved', migrated.tree.some(n => n.id === 'root/a.ts'));
    check('O: legacy files flattened to top level', migrated.tree.some(n => n.name === 'a.ts'));
    check('O: legacy expansion recovered (pruned to real ids)', migrated.expansion.has(ROOT) && migrated.expansion.has('root/src'));
    check('O: isOpen stripped from runtime nodes', migrated.tree.every(n => n.isOpen === undefined));
    assertValidFileTree(migrated.tree);

    // 3) Duplicate ids are repaired deterministically — same input, same output.
    const dupInput = () => [
        { id: ROOT, name: 'root', type: 'folder', children: [] },
        { id: 'x', name: 'x', type: 'folder', children: [] },
        { id: 'x', name: 'x', type: 'folder', children: [] },
    ];
    const r1 = repairFileTree(dupInput());
    const r2 = repairFileTree(dupInput());
    check('O: duplicate ids repaired uniquely', new Set(r1.tree.map(n => n.id)).size === r1.tree.length);
    check('O: duplicate repair is deterministic', JSON.stringify(r1.tree.map(n => n.id)) === JSON.stringify(r2.tree.map(n => n.id)));
    assertValidFileTree(r1.tree);

    // 4) Duplicate canonical roots never become nested copies.
    const twoRoots = [
        { id: ROOT, name: 'root', type: 'folder', children: [] },
        { id: ROOT, name: 'imposter', type: 'folder', children: [] },
    ];
    const fixed = repairFileTree(twoRoots);
    check('O: duplicate-root input repairs to ONE root', fixed.tree.filter(n => n.id === ROOT).length === 1);
    check('O: duplicate-root repair never nests a root copy', !fixed.tree.some(n => n.id !== ROOT && n.name === 'deep-context-ide'));
    check('O: duplicate-root repair keeps both siblings', fixed.tree.length === 2);
    assertValidFileTree(fixed.tree);

    // 5) Cycles / shared refs / garbage / empty.
    const evil = { id: ROOT, name: 'root', type: 'folder', children: [] as unknown[] };
    evil.children = [evil];
    const cyc = repairFileTree([evil]);
    check('O: cycle repair terminates + valid', validateFileTree(cyc.tree).valid && cyc.repaired);

    const shared: FileNode = mkFile(ROOT, 'shared.ts');
    const sharedTree = repairFileTree([mkFolder(ROOT, 'a', [shared]), mkFolder(ROOT, 'b', [shared])]);
    check('O: shared-ref repair valid', validateFileTree(sharedTree.tree).valid);

    const garbage = repairFileTree({ not: 'an array' } as unknown);
    check('O: garbage recovers to a fresh canonical root', validateFileTree(garbage.tree).valid && garbage.tree[0]?.id === ROOT);

    let deep: { id: string; name: string; type: 'folder'; children: unknown[] } = { id: 'd', name: 'd', type: 'folder', children: [] };
    for (let i = 0; i < 5000; i++) {
        deep = { id: `d${i}`, name: `d${i}`, type: 'folder', children: [deep] };
    }
    const deepResult = repairFileTree([deep]);
    check('O: 5000-deep input terminates + valid', validateFileTree(deepResult.tree).valid);
}

// ============================================================================
// P. Validation catches corruption
// ============================================================================
{
    const dupId = mkTree([
        { id: 'x', name: 'src', type: 'folder', parentId: ROOT, children: [] },
        { id: 'x', name: 'other', type: 'folder', parentId: ROOT, children: [] },
    ]);
    check('P: duplicate ids flagged', !validateFileTree(dupId).valid);

    const shared = mkFile(ROOT, 's.ts');
    const sharedRef = [mkFolder(ROOT, 'a', [shared]), mkFolder(ROOT, 'b', [shared])];
    check('P: shared reference flagged', !validateFileTree(sharedRef).valid);

    const badParent = mkTree([{ ...mkFile(ROOT, 'a.ts'), parentId: 'elsewhere' }]);
    check('P: parentId mismatch flagged', !validateFileTree(badParent).valid);

    const wrongRootCount = [
        { id: ROOT, name: 'root', type: 'folder', parentId: undefined, children: [] },
        { id: ROOT, name: 'imposter', type: 'folder', parentId: undefined, children: [] },
    ];
    check('P: multiple canonical roots flagged', !validateFileTree(wrongRootCount).valid);
}

// ============================================================================
// Q. Larger operation batches stay valid + collectFolderIds
// ============================================================================
{
    let tree = mkTree();
    for (let i = 0; i < 300; i++) {
        tree = createFile(tree, { name: `f${i}.ts`, parentId: ROOT, content: `// ${i}` }).tree;
    }
    assertValidFileTree(tree);
    check('Q: 300 files created', tree.filter(n => n.id !== ROOT).length === 300);

    tree = ensureFolderPath(tree, 'src/components').tree;
    const ids = collectFolderIds(tree);
    check('Q: collectFolderIds includes root', ids.has(ROOT));
    check('Q: collectFolderIds includes nested folders', ids.has(pathToId(tree, 'src')) && ids.has(pathToId(tree, 'src/components')));
}

// ============================================================================
// R. 10k-node performance (validate + sort + pathOf all terminate quickly)
// ============================================================================
{
    const bigFolder: FileNode = { id: generateNodeId(), name: 'big', type: 'folder', parentId: ROOT, children: [] };
    for (let i = 0; i < 10_000; i++) {
        bigFolder.children!.push({ id: generateNodeId(), name: `f${i}.ts`, type: 'file', parentId: bigFolder.id, content: '// x' });
    }
    const perfTree: FileNode[] = [
        { id: ROOT, name: 'root', type: 'folder', parentId: undefined, children: [] },
        bigFolder,
    ];
    const start = performance.now();
    const valid = validateFileTree(perfTree).valid;
    const sorted = sortTree(perfTree);
    const lastId = bigFolder.children![bigFolder.children!.length - 1].id;
    const p = pathOf(perfTree, lastId);
    const elapsed = performance.now() - start;
    check('R: 10k-node tree validates', valid);
    check('R: 10k-node sort terminates', sorted.length === 2 && sorted[1].children?.length === 10_000);
    check('R: pathOf over 10k nodes resolves', p === 'big/f9999.ts');
    check('R: 10k-node pipeline under 5s', elapsed < 5000);
    console.log(`   (10k pipeline took ${elapsed.toFixed(1)}ms)`);
}

finish('treeOperations');