import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import {
    createFile as opCreateFile,
    updateFileContent as opUpdateFileContent,
    deleteNode as opDeleteNode,
    renameNode as opRenameNode,
    ensureFolderPath,
} from '../src/core/filesystem/operations';
import { resolvePath, findNodeById } from '../src/utils/safeTree';
import { createExecutorDeps } from '../src/core/editor/workspaceBridge';
import { executeActionPlan, type AIAction } from '../src/core/ai/aiToolExecutor';

// Mock active editor store
const mockActiveEditorContext = {
    fileId: null as string | null,
    fileName: null as string | null,
    filePath: null as string | null,
    code: '',
    language: 'plaintext',
    lineCount: 0,
    cursor: null,
    selection: null,
    selectionText: null,
    documentVersionId: 0,
};

vi.mock('../src/core/editor/activeEditorStore', () => ({
    getActiveEditorContext: () => mockActiveEditorContext,
    getActiveEditor: () => null,
    getActiveMonaco: () => null,
    syncActiveEditor: vi.fn(),
    updateActiveFileMeta: vi.fn(),
}));

function createTestWorkspace() {
    let tree: FileNode[] = [];
    const getFileTree = () => tree;

    const createFile = (path: string, content = '') => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) {
            const ensured = ensureFolderPath(tree, dir);
            if (ensured.error) return { error: ensured.error };
            if (ensured.changed) tree = ensured.tree;
        }
        const parent = dir ? resolvePath(tree, dir) : null;
        const parentId = dir ? parent!.id : ROOT_NODE_ID;
        const r = opCreateFile(tree, { name, parentId, content });
        if (r.changed && r.node) {
            tree = r.tree;
        }
        return r.error ? { error: r.error } : { changed: true };
    };

    const updateFileContent = (fileId: string, content: string) => {
        const r = opUpdateFileContent(tree, fileId, content);
        if (r.changed) tree = r.tree;
        return r.error ? { error: r.error } : { changed: true };
    };

    const deleteNode = (id: string) => {
        const r = opDeleteNode(tree, id);
        if (r.changed) tree = r.tree;
    };

    const renameNode = (id: string, newName: string) => {
        const r = opRenameNode(tree, id, newName);
        if (r.changed) tree = r.tree;
        return r.error ? { error: r.error } : { changed: true };
    };

    return { getFileTree, createFile, updateFileContent, deleteNode, renameNode };
}

describe('workspaceBridge file tree synchronization', () => {
    let workspace: ReturnType<typeof createTestWorkspace>;

    beforeEach(() => {
        workspace = createTestWorkspace();
        mockActiveEditorContext.fileId = null;
        mockActiveEditorContext.fileName = null;
        mockActiveEditorContext.filePath = null;
        mockActiveEditorContext.code = '';
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should sync file tree immediately after successful updateFileContent', async () => {
        const { createFile, updateFileContent, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent },
            'test.js',
            'file-1'
        );

        // Create a file
        await createFile('test.js', 'console.log("hello");');
        const fileNode = resolvePath(getFileTree(), 'test.js');
        expect(fileNode).not.toBeNull();

        // Set up active editor context
        mockActiveEditorContext.fileId = fileNode!.id;
        mockActiveEditorContext.fileName = 'test.js';
        mockActiveEditorContext.filePath = 'test.js';
        mockActiveEditorContext.code = 'console.log("hello");';

        // Update via executor deps
        const result = deps.updateFileContent(fileNode!.id, 'console.log("world");');
        expect(result.success).toBe(true);

        // Verify file tree was updated
        const updatedNode = resolvePath(getFileTree(), 'test.js');
        expect(updatedNode).not.toBeNull();
        expect(updatedNode!.content).toBe('console.log("world");');
    });

    it('should prefer file tree content when no active editor context', async () => {
        const { createFile, updateFileContent, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent },
            'test.js',
            'file-1'
        );

        await createFile('test.js', 'console.log("hello");');
        const fileNode = resolvePath(getFileTree(), 'test.js');
        expect(fileNode).not.toBeNull();

        // No active editor context
        mockActiveEditorContext.fileId = null;
        mockActiveEditorContext.fileName = null;
        mockActiveEditorContext.filePath = null;
        mockActiveEditorContext.code = '';

        // Update via executor deps
        const result = deps.updateFileContent(fileNode!.id, 'console.log("world");');
        expect(result.success).toBe(true);

        // Verify file tree was updated
        const updatedNode = resolvePath(getFileTree(), 'test.js');
        expect(updatedNode).not.toBeNull();
        expect(updatedNode!.content).toBe('console.log("world");');

        // getFileContent should return tree content
        const content = deps.getFileContent('test.js');
        expect(content).toBe('console.log("world");');
    });

    it('should handle file tree as authoritative source on reopen', async () => {
        const { createFile, updateFileContent, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent },
            'test.js',
            'file-1'
        );

        await createFile('test.js', 'console.log("v1");');
        const fileNode = resolvePath(getFileTree(), 'test.js');
        expect(fileNode).not.toBeNull();

        // External change updates file tree directly
        const externalUpdate = updateFileContent(fileNode!.id, 'console.log("v2 from git");');
        expect(externalUpdate.changed).toBe(true);

        // When file is reopened, getFileContent should return the authoritative tree content
        // (active editor context is cleared on reopen)
        mockActiveEditorContext.fileId = null;
        mockActiveEditorContext.fileName = null;
        mockActiveEditorContext.filePath = null;
        mockActiveEditorContext.code = '';

        const content = deps.getFileContent('test.js');
        expect(content).toBe('console.log("v2 from git");');
    });

    it('should correctly identify file by ID even when path changes (rename)', async () => {
        const { createFile, updateFileContent, renameNode, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent },
            'old.js',
            'file-1'
        );

        await createFile('old.js', 'console.log("v1");');
        const fileNode = resolvePath(getFileTree(), 'old.js');
        expect(fileNode).not.toBeNull();

        mockActiveEditorContext.fileId = fileNode!.id;
        mockActiveEditorContext.fileName = 'old.js';
        mockActiveEditorContext.filePath = 'old.js';
        mockActiveEditorContext.code = 'console.log("v1");';

        // Rename the file
        const renameResult = renameNode(fileNode!.id, 'new.js');
        expect(renameResult.changed).toBe(true);

        // File should now be at new path
        const newNode = resolvePath(getFileTree(), 'new.js');
        expect(newNode).not.toBeNull();
        expect(newNode!.id).toBe(fileNode!.id); // Same ID

        // Update content after rename
        const updateResult = deps.updateFileContent(fileNode!.id, 'console.log("renamed");');
        expect(updateResult.success).toBe(true);

        const updatedNode = resolvePath(getFileTree(), 'new.js');
        expect(updatedNode!.content).toBe('console.log("renamed");');
    });

    it('should update file tree successfully even when active editor context exists', async () => {
        const { createFile, updateFileContent, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent },
            'test.js',
            'file-1'
        );

        await createFile('test.js', 'console.log("hello");');
        const fileNode = resolvePath(getFileTree(), 'test.js');
        expect(fileNode).not.toBeNull();

        // Set up active editor context
        mockActiveEditorContext.fileId = fileNode!.id;
        mockActiveEditorContext.fileName = 'test.js';
        mockActiveEditorContext.filePath = 'test.js';
        mockActiveEditorContext.code = 'console.log("hello");';

        // Update should succeed at file tree level
        const result = deps.updateFileContent(fileNode!.id, 'console.log("new");');
        expect(result.success).toBe(true);

        // File tree should be updated
        const updatedNode = resolvePath(getFileTree(), 'test.js');
        expect(updatedNode!.content).toBe('console.log("new");');
    });

    it('should create file and maintain consistent state', async () => {
        const { createFile, getFileTree } = workspace;
        const deps = createExecutorDeps(
            { getFileTree, createFile, deleteNode: workspace.deleteNode, renameNode: workspace.renameNode, updateFileContent: workspace.updateFileContent },
            'new.js',
            'file-1'
        );

        const result = deps.createFile('new.js', 'console.log("new file");');
        expect(result.success).toBe(true);

        const newNode = resolvePath(getFileTree(), 'new.js');
        expect(newNode).not.toBeNull();
        expect(newNode!.content).toBe('console.log("new file");');
    });
});