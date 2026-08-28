/**
 * Regression tests for the cycle-safe file-tree utilities (src/utils/safeTree).
 *
 * These cover the exact "too much recursion" crash class (Sidebar.tsx
 * countNodes) plus malformed/deep/cyclic trees. Run with: npx tsx tests/safeTree.test.ts
 */
import {
    sanitizeFileTree,
    countTree,
    anyFolderOpen,
    flattenTree,
    findNodeById,
    containsNode,
    collectIds,
    collectFiles,
    isDescendantOf,
    filterTree,
    flattenFileTreeString,
    walkTree,
    MAX_TREE_DEPTH,
} from '../src/utils/safeTree';
import type { FileNode } from '../src/utils/mockFileSystem';

let failed = 0;
let total = 0;
const check = (name: string, cond: boolean) => {
    total++;
    if (cond) {
        console.log(`ok: ${name}`);
    } else {
        failed++;
        console.error(`FAIL: ${name}`);
    }
};

// Helper: build a normal tree
const normalTree = (): FileNode[] => [
    {
        id: 'root', name: 'root', type: 'folder', isOpen: true,
        children: [
            { id: 'root/src', name: 'src', type: 'folder', isOpen: true, children: [
                { id: 'root/src/a.ts', name: 'a.ts', type: 'file', content: 'x' },
                { id: 'root/src/b.ts', name: 'b.ts', type: 'file', content: 'y' },
            ]},
            { id: 'root/readme.md', name: 'readme.md', type: 'file', content: 'z' },
        ],
    },
];

// ============================================================================
// A. Normal tree
// ============================================================================
{
    const tree = normalTree();
    const counts = countTree(tree);
    check('A: counts files', counts.files === 3);
    check('A: counts folders', counts.folders === 2);
    check('A: findNodeById root', findNodeById(tree, 'root')?.name === 'root');
    check('A: findNodeById deep', findNodeById(tree, 'root/src/b.ts')?.type === 'file');
    check('A: containsNode true', containsNode(tree, 'root/readme.md'));
    check('A: containsNode false', !containsNode(tree, 'nope'));
    check('A: collectIds size', collectIds(tree).size === 5);
    check('A: collectFiles length', collectFiles(tree).length === 3);
    check('A: anyFolderOpen true', anyFolderOpen(tree));
    check('A: flattenTree open folders', flattenTree(tree).length === 5);
    check('A: sanitize preserves structure', sanitizeFileTree(tree).length === 1);
    check('A: flattenFileTreeString', flattenFileTreeString(tree, 0, 2).includes('- root (folder)'));
}

// ============================================================================
// B. Empty tree
// ============================================================================
{
    check('B: countTree empty', countTree([]).files === 0 && countTree([]).folders === 0);
    check('B: countTree null', countTree(null).files === 0);
    check('B: countTree undefined', countTree(undefined).files === 0);
    check('B: sanitize empty', sanitizeFileTree([]).length === 0);
    check('B: flattenTree empty', flattenTree([]).length === 0);
    check('B: findNodeById empty', findNodeById([], 'x') === null);
    check('B: anyFolderOpen empty', !anyFolderOpen([]));
    check('B: flattenFileTreeString empty', flattenFileTreeString([]) === '');
}

// ============================================================================
// C. null children
// ============================================================================
{
    const tree: FileNode[] = [
        { id: 'root', name: 'root', type: 'folder', isOpen: true, children: null as unknown as FileNode[] },
        { id: 'f', name: 'f', type: 'file' },
    ];
    const counts = countTree(tree);
    check('C: countTree null children', counts.files === 1 && counts.folders === 1);
    check('C: walkTree null children', flattenTree(tree).length === 2);
    check('C: sanitize null children', sanitizeFileTree(tree)[0]?.children?.length === 0);
}

// ============================================================================
// D. Self-referencing node
// ============================================================================
{
    const root: FileNode = { id: 'root', name: 'root', type: 'folder', isOpen: true, children: [] };
    root.children = [root]; // root is its own child — the Sidebar crash case
    const tree: FileNode[] = [root];

    let terminated = true;
    let count = 0;
    try {
        count = countTree(tree).folders;
    } catch {
        terminated = false;
    }
    check('D: countTree terminates on self-reference', terminated);
    check('D: self-reference counted once', count === 1);

    const sanitized = sanitizeFileTree(tree);
    check('D: sanitize breaks self-reference', sanitized[0]?.children?.length === 0);

    const ids = collectIds(tree);
    check('D: collectIds terminates + dedupes', ids.size === 1);

    const listed = flattenFileTreeString(tree, 0, 2);
    check('D: flattenFileTreeString terminates', listed.includes('- root (folder)'));
}

// ============================================================================
// E. A -> B -> A cycle
// ============================================================================
{
    const a: FileNode = { id: 'a', name: 'a', type: 'folder', isOpen: true, children: [] };
    const b: FileNode = { id: 'b', name: 'b', type: 'folder', isOpen: true, children: [] };
    const c: FileNode = { id: 'c', name: 'c', type: 'file' };
    a.children = [b, c];
    b.children = [a]; // cycle back to A
    const tree: FileNode[] = [a];

    const counts = countTree(tree);
    check('E: countTree terminates on A->B->A', counts.files === 1 && counts.folders === 2);

    const sanitized = sanitizeFileTree(tree);
    check('E: sanitize breaks cycle', sanitized[0]?.children?.length === 2);
    check('E: sanitized acyclic', countTree(sanitized).folders === 2);

    const found = findNodeById(tree, 'c');
    check('E: findNodeById still finds c', found?.id === 'c');
    check('E: containsNode', containsNode(tree, 'b'));
}

// ============================================================================
// F. Duplicate node references (shared identity under two parents)
// ============================================================================
{
    const shared: FileNode = { id: 'shared', name: 'shared.ts', type: 'file' };
    const tree: FileNode[] = [
        { id: 'p1', name: 'p1', type: 'folder', children: [shared] },
        { id: 'p2', name: 'p2', type: 'folder', children: [shared] },
    ];

    let terminated = true;
    let files = 0;
    try {
        files = countTree(tree).files;
    } catch {
        terminated = false;
    }
    check('F: countTree terminates on duplicate refs', terminated);
    check('F: duplicate ref counted once', files === 1);

    const sanitized = sanitizeFileTree(tree);
    check('F: sanitize dedupes shared identity', countTree(sanitized).files === 1);
    check('F: sanitize keeps both parents', sanitized.length === 2);
}

// ============================================================================
// G. Very deep tree
// ============================================================================
{
    let root: FileNode = { id: 'deep0', name: 'deep0', type: 'file' };
    for (let i = 1; i < 5000; i++) {
        root = { id: `deep${i}`, name: `deep${i}`, type: 'folder', isOpen: true, children: [root] };
    }
    const tree: FileNode[] = [root];

    let terminated = true;
    let folders = 0;
    try {
        folders = countTree(tree).folders;
    } catch {
        terminated = false;
    }
    check('G: countTree terminates on 5000-deep tree', terminated);
    check('G: deep traversal bounded by depth cap', folders === MAX_TREE_DEPTH + 1);

    const sanitized = sanitizeFileTree(tree);
    check('G: sanitize caps depth', countTree(sanitized).folders <= MAX_TREE_DEPTH + 1);
    check('G: flattenFileTreeString bounded', flattenFileTreeString(tree, 0, 2).split('\n').length <= 4);
}

// ============================================================================
// H. Malformed nodes
// ============================================================================
{
    const tree = [
        null,
        42,
        'string',
        { id: 'ok', name: 'ok.ts', type: 'file' },
        { name: 'no-id', type: 'file' },
        { id: 'badtype', name: 'x', type: 'symlink' },
        { id: 'folder-childless', name: 'dir', type: 'folder' },
        undefined,
    ] as unknown as FileNode[];

    const sanitized = sanitizeFileTree(tree);
    check('H: malformed primitives dropped', sanitized.length === 4);
    check('H: missing id gets generated', sanitized[1].id !== undefined);
    check('H: wrong type coerced to file', sanitized[2].type === 'file');
    check('H: folder type preserved', sanitized[3].type === 'folder');
    check('H: folder children normalized to array', Array.isArray(sanitized[3].children));

    let terminated = true;
    try {
        countTree(tree);
        flattenTree(tree);
        collectIds(tree);
    } catch {
        terminated = false;
    }
    check('H: traversals terminate on malformed nodes', terminated);
}

// ============================================================================
// I. Thousands of files
// ============================================================================
{
    const tree: FileNode[] = [];
    for (let i = 0; i < 10000; i++) {
        tree.push({ id: `f${i}`, name: `f${i}.txt`, type: 'file' });
    }
    check('I: countTree 10k files', countTree(tree).files === 10000);
    check('I: collectIds 10k', collectIds(tree).size === 10000);
    check('I: sanitize 10k', sanitizeFileTree(tree).length === 10000);
    check('I: filterTree 10k', filterTree(tree, { predicate: () => true }).length === 10000);
    check('I: flattenFileTreeString 10k', flattenFileTreeString(tree, 0, 2).split('\n').length === 10001);
}

// ============================================================================
// Regression: the exact Sidebar crash (countNodes on a cyclic tree) must not
// throw "too much recursion". Sidebar now uses countTree/anyFolderOpen.
// ============================================================================
{
    const root: FileNode = { id: 'root', name: 'root', type: 'folder', isOpen: true, children: [] };
    root.children = [root];
    const cyclicTree: FileNode[] = [root];

    let crashed = false;
    let counts;
    let open;
    try {
        counts = countTree(cyclicTree);
        open = anyFolderOpen(cyclicTree);
    } catch {
        crashed = true;
    }
    check('crash: countTree does not throw on cyclic tree', !crashed);
    check('crash: anyFolderOpen does not throw on cyclic tree', !crashed);
    check('crash: counts are finite', counts !== undefined && counts.folders === 1);
    check('crash: open flag is boolean', typeof open === 'boolean');

    // Sidebar feeds memoized counts from the sanitized tree:
    const sanitized = sanitizeFileTree(cyclicTree);
    const memoCounts = countTree(sanitized);
    check('crash: memoized countTree is safe after sanitize', memoCounts.folders === 1 && memoCounts.files === 0);
}

// ============================================================================
// Structural safety: no mutation of the input; walkTree prunes correctly
// ============================================================================
{
    const tree = normalTree();
    const snapshot = JSON.stringify(tree);
    countTree(tree);
    flattenTree(tree);
    filterTree(tree, { predicate: () => false, forceOpen: true });
    collectFiles(tree);
    isDescendantOf(tree, 'root/src', 'root/src/a.ts');
    sanitizeFileTree(tree);
    check('mutation: input tree is not mutated by any utility', JSON.stringify(tree) === snapshot);

    check('isDescendantOf: direct child', isDescendantOf(tree, 'root/src', 'root/src/a.ts'));
    check('isDescendantOf: self', isDescendantOf(tree, 'root/src', 'root/src'));
    check('isDescendantOf: not descendant', !isDescendantOf(tree, 'root/src', 'root/readme.md'));
    check('isDescendantOf: unknown ancestor', !isDescendantOf(tree, 'zzz', 'root'));

    // filterTree: include parents of matches, force open
    const filtered = filterTree(tree, {
        forceOpen: true,
        predicate: (n) => n.name.includes('a.ts'),
    });
    check('filter: matched leaf present', findNodeById(filtered, 'root/src/a.ts') !== null);
    check('filter: parent kept when child matches', findNodeById(filtered, 'root/src') !== null);
    check('filter: unrelated sibling dropped', findNodeById(filtered, 'root/readme.md') === null);
    check('filter: forceOpen', (findNodeById(filtered, 'root') as FileNode | null)?.isOpen === true);

    // skip: hidden files pruned entirely (including their subtrees)
    const hidden = [
        { id: '.git', name: '.git', type: 'folder', children: [{ id: '.git/x', name: 'x', type: 'file' }] },
        { id: 'app.ts', name: 'app.ts', type: 'file' },
    ];
    const visible = filterTree(hidden, { skip: (n) => n.name.startsWith('.') });
    check('filter: hidden pruned', visible.length === 1 && visible[0].id === 'app.ts');
}

// ============================================================================
// walkTree ordering + pruning + cycle safety
// ============================================================================
{
    const seen: string[] = [];
    walkTree(normalTree(), (n) => {
        seen.push(n.id);
        if (n.id === 'root/src') return false; // prune
    });
    check('walkTree: prunes subtree', seen.includes('root/src') && !seen.includes('root/src/a.ts'));
    check('walkTree: still visits siblings', seen.includes('root/readme.md'));

    const root: FileNode = { id: 'root', name: 'root', type: 'folder', children: [] };
    root.children = [root, { id: 'file', name: 'file', type: 'file' }];
    let files = 0;
    walkTree([root], (n) => { if (n.type === 'file') files++; });
    check('walkTree: cycle-safe', files === 1);
}

console.log(failed === 0 ? `\nALL PASS (${total})` : `\n${failed}/${total} FAILURES`);
if (!process.env.VITEST) process.exit(failed === 0 ? 0 : 1);