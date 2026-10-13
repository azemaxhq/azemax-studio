/**
 * Filesystem read queries — normalized, traversal-safe resource resolution.
 *
 * Single home for "given a user/AI/import-supplied path, what resource does it
 * mean?" Previously each caller (AI tool registry, workspace snapshot,
 * terminal, path actions) rolled its own cleaning with different traversal
 * rules. All strict entry points reject `..` instead of clamping it, so an
 * archive or AI path can never escape the workspace.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { findNodeById, pathOf, resolvePath } from '../../utils/safeTree';

export const MAX_RESOURCE_PATH_LENGTH = 512;

export type NormalizeResult = { ok: true; path: string } | { ok: false; error: string };

const HAS_CONTROL_CHARS = /[\u0000-\u001F]/; // eslint-disable-line no-control-regex

/**
 * Normalize a workspace-relative path. Leading `/` and `~/` are accepted and
 * stripped; `.` segments are dropped. In strict mode (default) `..` segments,
 * control characters, and over-long input are rejected with an error instead
 * of being silently clamped.
 */
export function normalizeResourcePath(input: unknown, opts?: { allowEmpty?: boolean }): NormalizeResult {
    if (typeof input !== 'string') return { ok: false, error: 'Invalid path' };
    let cleaned = input.trim().replace(/\\/g, '/');
    if (cleaned.startsWith('~')) cleaned = cleaned.replace(/^~\/+/, '').replace(/^~$/, '');
    cleaned = cleaned.replace(/^\/+/, '');
    const segments = cleaned.split('/').filter((s) => s.length > 0 && s !== '.');
    if (segments.length === 0) {
        return opts?.allowEmpty ? { ok: true, path: '' } : { ok: false, error: 'Invalid path' };
    }
    if (cleaned.length > MAX_RESOURCE_PATH_LENGTH || input.length > MAX_RESOURCE_PATH_LENGTH) {
        return { ok: false, error: 'Path too long' };
    }
    for (const seg of segments) {
        if (seg === '..') return { ok: false, error: 'Invalid path: contains ..' };
        if (seg.length > 255) return { ok: false, error: 'Invalid path segment' };
        if (HAS_CONTROL_CHARS.test(seg)) return { ok: false, error: 'Invalid path' };
    }
    return { ok: true, path: segments.join('/') };
}

export interface ResolveOptions {
    /** Fall back to a bare-name match when the path does not resolve. */
    fallbackNameMatch?: boolean;
}

/**
 * Resolve a workspace-relative path to a node. Returns null for missing,
 * invalid, or traversal-attempt paths. Never throws.
 */
export function resolveResource(
    tree: readonly FileNode[],
    input: unknown,
    opts?: ResolveOptions,
): FileNode | null {
    const normalized = normalizeResourcePath(input, { allowEmpty: true });
    if (!normalized.ok) return null;
    if (normalized.path === '') return null;
    const hit = resolvePath(tree, normalized.path);
    if (hit && hit.id !== ROOT_NODE_ID) return hit;
    if (hit) return null;
    if (opts?.fallbackNameMatch && typeof input === 'string') {
        const name = input.trim();
        if (!name || name.includes('/')) return null;
        return findByName(tree, name);
    }
    return null;
}

function findByName(nodes: readonly FileNode[], name: string): FileNode | null {
    const stack: FileNode[] = [...nodes];
    const seen = new Set<object>();
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (!node || seen.has(node)) continue;
        seen.add(node);
        if (node.name === name && node.id !== ROOT_NODE_ID) return node;
        const kids = node.children;
        if (Array.isArray(kids)) for (const k of kids) stack.push(k);
    }
    return null;
}

/**
 * List a directory's children. Empty path = workspace root (top-level
 * siblings, excluding the synthetic root container). Files, missing paths,
 * and traversal attempts yield `[]`.
 */
export function listDirectory(tree: readonly FileNode[], input: unknown): FileNode[] {
    const normalized = normalizeResourcePath(input, { allowEmpty: true });
    if (!normalized.ok) return [];
    if (normalized.path === '') return (tree as FileNode[]).filter((n) => n.id !== ROOT_NODE_ID);
    const dir = resolvePath(tree, normalized.path);
    if (!dir || dir.type !== 'folder' || dir.id === ROOT_NODE_ID) {
        // A path resolving to the synthetic root lists the workspace root.
        if (dir && dir.id === ROOT_NODE_ID) {
            return (tree as FileNode[]).filter((n) => n.id !== ROOT_NODE_ID);
        }
        return [];
    }
    return dir.children ?? [];
}

/** Read a file's content by path. Returns null for missing/non-file/invalid paths. */
export function readFileContent(tree: readonly FileNode[], input: unknown): string | null {
    const node = resolveResource(tree, input);
    if (!node || node.type !== 'file') return null;
    return typeof node.content === 'string' ? node.content : '';
}

export interface ResourceMetadata {
    id: string;
    name: string;
    type: 'file' | 'folder';
    /** Workspace-relative path derived from the parentId chain. */
    path: string;
    parentId: string;
    /** Content length for files, descendant count for folders. */
    size: number;
    childCount: number;
}

/** Metadata for a node addressed by stable id or workspace-relative path. */
export function getResourceMetadata(
    tree: readonly FileNode[],
    idOrPath: unknown,
): ResourceMetadata | null {
    const node =
        typeof idOrPath === 'string' && findNodeById(tree, idOrPath)
            ? findNodeById(tree, idOrPath)!
            : resolveResource(tree, idOrPath);
    if (!node || node.id === ROOT_NODE_ID) return null;
    const path = pathOf(tree, node.id) || node.name;
    const kids = node.type === 'folder' && Array.isArray(node.children) ? node.children : [];
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        path,
        parentId: node.parentId ?? ROOT_NODE_ID,
        size: node.type === 'file' ? (node.content ?? '').length : kids.length,
        childCount: kids.length,
    };
}
