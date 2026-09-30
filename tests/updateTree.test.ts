/**
 * Regression tests for the iterative, cycle-safe structural tree updates
 * (updateNodeById / deleteNodeById / insertNodeIntoFolder / mapTree in
 * src/utils/safeTree). These cover the "too much recursion" crash class from
 * ProjectContext.updateFileContent on cyclic / pathologically deep trees.
 *
 * Run with: npx tsx tests/updateTree.test.ts
 */
import { updateNodeById, deleteNodeById, insertNodeIntoFolder, mapTree } from '../src/utils/safeTree';
import type { FileNode } from '../src/utils/mockFileSystem';
import { check, finish } from './_harness';

// Normal acyclic tree with stable reference handles.
const stableTree = (): { tree: FileNode[]; leaf: FileNode; readme: FileNode; src: FileNode } => {
    const readme: FileNode = { id: 'root/readme.md', name: 'readme.md', type: 'file', content: 'z' };
    const a: FileNode = { id: 'root/src/a.ts', name: 'a.ts', type: 'file', content: 'x' };
    const b: FileNode = { id: 'root/src/b.ts', name: 'b.ts', type: 'file', content: 'y' };
    const src: FileNode = { id: 'root/src', name: 'src', type: 'folder', isOpen: true, children: [a, b] };
    const root: FileNode = { id: 'root', name: 'root', type: 'folder', isOpen: true, children: [src, readme] };
    return { tree: [root], leaf: b, readme, src };
};

// Cyclic tree: `folder` contains itself in its children array.
const cyclicTree = (): FileNode[] => {
    const a: FileNode = { id: 'root/f/a.ts', name: 'a.ts', type: 'file', content: 'x' };
    const readme: FileNode = { id: 'root/readme.md', name: 'readme.md', type: 'file', content: 'z' };
    const folder: FileNode = { id: 'root/f', name: 'f', type: 'folder', isOpen: true, children: [a] };
    (folder.children as FileNode[]).push(folder); // self-cycle
    const root: FileNode = { id: 'root', name: 'root', type: 'folder', isOpen: true, children: [folder, readme] };
    return [root];
};

// ============================================================================
// A. updateNodeById = ProjectContext.updateFileContent semantics
// ============================================================================
{
    const { tree, leaf, readme } = stableTree();
    const updated = updateNodeById(tree, 'root/src/b.ts', node =>
        node.content === 'NEW' ? node : { ...node, content: 'NEW' }
    );
    check('A: content updated', find(updated, 'root/src/b.ts').content === 'NEW');
    check('A: returns new tree reference', updated !== tree);
    check('A: root cloned', updated[0] !== tree[0]);
    check('A: src cloned', find(updated, 'root/src') !== find(tree, 'root/src'));
    check('A: changed file cloned', find(updated, 'root/src/b.ts') !== leaf);
    check('A: unchanged file keeps identity', find(updated, 'root/src/a.ts') === find(tree, 'root/src/a.ts'));
    check('A: unrelated branch keeps identity', find(updated, 'root/readme.md') === readme);
}

{
    // Content identical -> no change, original reference returned.
    const { tree, readme } = stableTree();
    const updated = updateNodeById(tree, 'root/src/b.ts', node =>
        node.content === 'y' ? node : { ...node, content: 'y' }
    );
    check('A: identical content returns original tree', updated === tree);
    check('A: identical content keeps node identity', find(updated, 'root/src/b.ts') === find(tree, 'root/src/b.ts'));
    check('A: identical content keeps sibling identity', find(updated, 'root/readme.md') === readme);
}

{
    // Missing target -> original tree reference, no crash.
    const { tree } = stableTree();
    const updated = updateNodeById(tree, 'root/missing.ts', node => ({ ...node, content: 'x' }));
    check('A: missing target returns original tree', updated === tree);
}

{
    // Cyclic tree: must terminate without RangeError and update correctly.
    const tree = cyclicTree();
    const updated = updateNodeById(tree, 'root/f/a.ts', node =>
        node.content === 'changed' ? node : { ...node, content: 'changed' }
    );
    check('A: cyclic tree update terminates', true);
    check('A: cyclic tree content updated', find(updated, 'root/f/a.ts').content === 'changed');
    check('A: cyclic tree sibling keeps identity', find(updated, 'root/readme.md') === find(tree, 'root/readme.md'));
    check('A: cyclic tree ancestors cloned', find(updated, 'root/f') !== find(tree, 'root/f') && updated[0] !== tree[0]);
    check('A: cyclic tree keeps original untouched', find(tree, 'root/f/a.ts').content === 'x');
}

{
    // Pathologically deep (but finite) chain: recursion would overflow the stack.
    const leaf: FileNode = { id: 'd0/l', name: 'l', type: 'file', content: 'v' };
    let cur: FileNode = leaf;
    for (let i = 1; i <= 3000; i++) {
        cur = { id: `d${i}`, name: `d${i}`, type: 'folder', children: [cur] };
    }
    const tree: FileNode[] = [cur];
    const updated = updateNodeById(tree, 'd0/l', node => ({ ...node, content: 'w' }));
    check('A: deep chain update terminates', true);
    check('A: deep chain content updated', find(updated, 'd0/l').content === 'w');
    check('A: deep chain root cloned', updated[0] !== tree[0]);
}

// ============================================================================
// B. deleteNodeById
// ============================================================================
{
    const { tree, readme } = stableTree();
    const updated = deleteNodeById(tree, 'root/src/b.ts');
    check('B: node removed', find(updated, 'root/src/b.ts') === null);
    check('B: sibling file keeps identity', find(updated, 'root/src/a.ts') === find(tree, 'root/src/a.ts'));
    check('B: unrelated branch keeps identity', find(updated, 'root/readme.md') === readme);
    check('B: folder children rebuilt', find(updated, 'root/src').children.length === 1);
}

{
    const { tree } = stableTree();
    const updated = deleteNodeById(tree, 'root/missing.ts');
    check('B: missing target returns original tree', updated === tree);
}

{
    const tree = cyclicTree();
    const updated = deleteNodeById(tree, 'root/readme.md');
    check('B: cyclic delete terminates', true);
    check('B: cyclic delete removes node', find(updated, 'root/readme.md') === null);
    check('B: cyclic delete keeps sibling', find(updated, 'root/f') !== null);
    check('B: cyclic delete keeps original untouched', find(tree, 'root/readme.md') !== null);
}

// ============================================================================
// C. insertNodeIntoFolder
// ============================================================================
{
    const { tree, readme, src } = stableTree();
    const added: FileNode = { id: 'root/src/c.ts', name: 'c.ts', type: 'file', content: 'c' };
    const updated = insertNodeIntoFolder(tree, 'root/src', added, true);
    check('C: node inserted', find(updated, 'root/src/c.ts') === added);
    check('C: folder opened', find(updated, 'root/src').isOpen === true);
    check('C: folder cloned', find(updated, 'root/src') !== src);
    check('C: existing child keeps identity', find(updated, 'root/src/a.ts') === find(tree, 'root/src/a.ts'));
    check('C: unrelated branch keeps identity', find(updated, 'root/readme.md') === readme);
    check('C: original untouched', find(tree, 'root/src').children.length === 2);
}

{
    const { tree } = stableTree();
    const added: FileNode = { id: 'root/src/c.ts', name: 'c.ts', type: 'file', content: 'c' };
    const updated = insertNodeIntoFolder(tree, 'root/missing', added, true);
    check('C: missing folder returns original tree', updated === tree);
}

{
    const tree = cyclicTree();
    const added: FileNode = { id: 'root/f/new.ts', name: 'new.ts', type: 'file', content: 'n' };
    const updated = insertNodeIntoFolder(tree, 'root/f', added, true);
    check('C: cyclic insert terminates', true);
    check('C: cyclic insert adds node', find(updated, 'root/f/new.ts') === added);
    check('C: cyclic insert keeps sibling identity', find(updated, 'root/readme.md') === find(tree, 'root/readme.md'));
}

// ============================================================================
// D. mapTree (collapseAll / expandAll / expandRecursively)
// ============================================================================
{
    const { tree, readme } = stableTree();
    const updated = mapTree(tree, node => (node.type === 'folder' ? { ...node, isOpen: false } : node));
    check('D: folders collapsed', find(updated, 'root').isOpen === false && find(updated, 'root/src').isOpen === false);
    check('D: files untouched', find(updated, 'root/src/b.ts').content === 'y');
    check('D: file identity preserved', find(updated, 'root/src/b.ts') === find(tree, 'root/src/b.ts'));
    check('D: readme identity preserved', find(updated, 'root/readme.md') === readme);
    check('D: original untouched', find(tree, 'root/src').isOpen === true);
}

{
    const tree = cyclicTree();
    const updated = mapTree(tree, node => (node.type === 'folder' ? { ...node, isOpen: false } : node));
    check('D: cyclic map terminates', true);
    check('D: cyclic map collapses folders', find(updated, 'root').isOpen === false);
    check('D: cyclic map keeps file identity', find(updated, 'root/f/a.ts') === find(tree, 'root/f/a.ts'));
}

{
    // Identity transform returns the original tree reference.
    const { tree } = stableTree();
    const updated = mapTree(tree, node => node);
    check('D: identity transform returns original', updated === tree);
}

// ============================================================================
// E. Malformed / null children never crash
// ============================================================================
{
    const malformed: FileNode[] = [
        { id: 'root', name: 'root', type: 'folder', children: [null as unknown as FileNode, undefined as unknown as FileNode, 'junk' as unknown as FileNode] },
    ];
    const added: FileNode = { id: 'root/f.ts', name: 'f.ts', type: 'file', content: 'f' };
    check('E: update on malformed children terminates', updateNodeById(malformed, 'nope', n => ({ ...n })) === malformed);
    check('E: delete on malformed children terminates', deleteNodeById(malformed, 'nope') === malformed);
    const inserted = insertNodeIntoFolder(malformed, 'root', added, true);
    check('E: insert on malformed children terminates', inserted !== malformed && find(inserted, 'root/f.ts') === added);
    check('E: map on malformed children terminates', Array.isArray(mapTree(malformed, n => n)));
}

// ============================================================================

function find(nodes: FileNode[], id: string): FileNode | null {
    const visited = new WeakSet<object>();
    const stack: FileNode[] = [];
    for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i] && typeof nodes[i] === 'object') stack.push(nodes[i]);
    }
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node.id === id) return node;
        if (Array.isArray(node.children)) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                const child = node.children[i];
                if (child && typeof child === 'object') stack.push(child);
            }
        }
    }
    return null;
}

finish('updateTree');