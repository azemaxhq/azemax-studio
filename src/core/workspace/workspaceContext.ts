/**
 * Workspace Context Provider — fresh Monaco + project structure as source of truth.
 *
 * - Always reads current Monaco model at request time (no debounced React state).
 * - Exposes workspace abstraction so AI can safely create/rename/delete/modify,
 *   switch/read other files, understand file names, language, and project structure.
 * - Re-reads after every mutation when necessary (caller should snapshot before/after).
 */

import type { ActiveEditorContext } from '../editor/activeEditorStore';
import type { FileNode } from '../../utils/mockFileSystem';

export interface WorkspaceSnapshot {
    activeEditor: ActiveEditorContext | null;
    fileName: string | null;
    language: string | null;
    code: string | null;
    lineCount: number;
    selectionText: string | null;
    selectionRange: ActiveEditorContext['selection'];
    fileTree: FileNode[];
    fileTreeString: string;
    /** Map of path -> content for quick lookup (fresh at snapshot time) */
    fileMap: Map<string, string>;
    /** List of all file paths */
    allFilePaths: string[];
}

function flattenFileTree(nodes: FileNode[], depth = 0, maxDepth = 3): string {
    if (depth > maxDepth) return '';
    let result = '';
    const indent = '  '.repeat(depth);
    for (const node of nodes) {
        result += `${indent}- ${node.name} (${node.type})\n`;
        if (node.children) result += flattenFileTree(node.children, depth + 1, maxDepth);
    }
    return result;
}

function collectFileMap(nodes: FileNode[], map: Map<string, string>, paths: string[]): void {
    for (const node of nodes) {
        if (node.type === 'file' && typeof node.content === 'string') {
            const key = node.name;
            map.set(key, node.content);
            paths.push(key);
        }
        if (node.children) collectFileMap(node.children, map, paths);
    }
}

export function buildWorkspaceSnapshot(
    editorContext: ActiveEditorContext | null,
    fileTree: FileNode[]
): WorkspaceSnapshot {
    const fileTreeString = flattenFileTree(fileTree, 0, 3);
    const fileMap = new Map<string, string>();
    const allFilePaths: string[] = [];
    collectFileMap(fileTree, fileMap, allFilePaths);

    return {
        activeEditor: editorContext,
        fileName: editorContext?.fileName ?? null,
        language: editorContext?.language ?? null,
        code: editorContext?.code ?? null,
        lineCount: editorContext?.lineCount ?? 0,
        selectionText: editorContext?.selectionText ?? null,
        selectionRange: editorContext?.selection ?? null,
        fileTree,
        fileTreeString,
        fileMap,
        allFilePaths,
    };
}

export function readFileFresh(snapshot: WorkspaceSnapshot, targetPath: string): string | null {
    if (snapshot.fileMap.has(targetPath)) return snapshot.fileMap.get(targetPath)!;
    // Fallback: active editor if path matches
    if (snapshot.fileName && targetPath === snapshot.fileName && snapshot.code !== null) return snapshot.code;
    return null;
}

export function resolveWorkspaceFileId(
    fileTree: FileNode[],
    targetName: string
): string | null {
    const find = (nodes: FileNode[], name: string): FileNode | null => {
        for (const n of nodes) {
            if (n.name === name) return n;
            if (n.children) {
                const found = find(n.children, name);
                if (found) return found;
            }
        }
        return null;
    };
    const node = find(fileTree, targetName);
    return node?.id ?? null;
}
