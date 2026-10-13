/**
 * Tool Registry — structured IDE tools for the Cursor-style Agent.
 * Extends aiToolExecutor's mutation tools with read/search/list/diagnostics/context.
 * Every tool is atomic, validates inputs, and reads fresh state.
 */

import { getActiveEditorContext } from '../editor/activeEditorStore';
import type { FileNode } from '../../utils/mockFileSystem';
import { normalizeResourcePath, resolveResource, listDirectory } from '../filesystem/queries';

export type ToolName =
    | 'read_file'
    | 'search_files'
    | 'list_files'
    | 'create_file'
    | 'rename_file'
    | 'delete_file'
    | 'replace_range'
    | 'insert_text'
    | 'delete_range'
    | 'apply_patch'
    | 'get_diagnostics'
    | 'get_editor_context'
    | 'open_file'
    | 'run_code';

export interface ToolDefinition {
    name: ToolName;
    description: string;
    parameters: Record<string, { type: string; required: boolean; description: string }>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    { name: 'read_file', description: 'Read file content by path. Returns full content or null if not found.', parameters: { path: { type: 'string', required: true, description: 'Workspace-relative path e.g. src/App.tsx or bare name' } } },
    { name: 'search_files', description: 'Search all workspace files for a query string. Returns matched files with snippets.', parameters: { query: { type: 'string', required: true, description: 'Substring to search' }, maxResults: { type: 'number', required: false, description: 'Max hits (default 10)' } } },
    { name: 'list_files', description: 'List files/dirs under a path. Empty path = workspace root.', parameters: { path: { type: 'string', required: false, description: 'Directory path, or empty for root' } } },
    { name: 'create_file', description: 'Create a new file. Fails if path invalid or traversal ..', parameters: { path: { type: 'string', required: true, description: 'Full path' }, content: { type: 'string', required: false, description: 'Initial content' } } },
    { name: 'rename_file', description: 'Rename/move a file or folder.', parameters: { oldPath: { type: 'string', required: true, description: 'Current path' }, newPath: { type: 'string', required: true, description: 'New path (may include new dir)' } } },
    { name: 'delete_file', description: 'Delete a file or folder. Requires explicit user intent — do not guess.', parameters: { path: { type: 'string', required: true, description: 'Path to delete' } } },
    { name: 'replace_range', description: 'Replace a line/column range in a file with new text. Use for surgical edits.', parameters: { path: { type: 'string', required: true, description: 'Target file path' }, startLine: { type: 'number', required: true, description: '1-based start line' }, startColumn: { type: 'number', required: false, description: '1-based start col (default 1)' }, endLine: { type: 'number', required: true, description: '1-based end line' }, endColumn: { type: 'number', required: false, description: 'End col (default end of line)' }, newText: { type: 'string', required: true, description: 'Replacement text' } } },
    { name: 'insert_text', description: 'Insert text at a position.', parameters: { path: { type: 'string', required: true, description: 'File path' }, line: { type: 'number', required: true, description: '1-based line' }, column: { type: 'number', required: false, description: '1-based col (default 1)' }, text: { type: 'string', required: true, description: 'Text to insert' } } },
    { name: 'delete_range', description: 'Delete a line range.', parameters: { path: { type: 'string', required: true, description: 'File path' }, startLine: { type: 'number', required: true, description: '1-based' }, endLine: { type: 'number', required: true, description: '1-based inclusive' } } },
    { name: 'apply_patch', description: 'Apply a unified diff patch to a file.', parameters: { path: { type: 'string', required: true, description: 'File path' }, patch: { type: 'string', required: true, description: 'Unified diff content' } } },
    { name: 'get_diagnostics', description: 'Get syntax/semantic diagnostics for a file.', parameters: { path: { type: 'string', required: true, description: 'File path' } } },
    { name: 'get_editor_context', description: 'Get live editor context: active file, content window, selection, cursor, language.', parameters: {} },
    { name: 'open_file', description: 'Open a file in the editor (sets active file).', parameters: { path: { type: 'string', required: true, description: 'File path' } } },
    { name: 'run_code', description: 'Execute code (active file or supplied code). Returns stdout/stderr.', parameters: { path: { type: 'string', required: false, description: 'File path to run (defaults to active file)' }, code: { type: 'string', required: false, description: 'Direct code to run (overrides file)' } } },
];

export interface ToolRegistryDeps {
    getFileTree: () => FileNode[];
    getActiveFile?: () => FileNode | null;
    createFile: (path: string, content?: string) => { changed: boolean; error?: { message: string } };
    renameNode?: (id: string, newName: string) => { changed: boolean; error?: { message: string } };
    deleteNode: (id: string) => void;
    updateFileContent: (fileId: string, content: string) => { changed: boolean; error?: { message: string } };
    setActiveFile?: (file: FileNode) => void;
}

function findByPath(tree: FileNode[], target: string): FileNode | null {
    return resolveResource(tree, target, { fallbackNameMatch: true });
}

function listChildren(tree: FileNode[], dirPath: string): FileNode[] {
    return listDirectory(tree, dirPath);
}

function validatePath(p: string): string | null {
    const result = normalizeResourcePath(p);
    return result.ok ? null : result.error;
}

export function createToolRegistry(deps: ToolRegistryDeps) {
    const registry = {
        async execute(tool: ToolName, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
            try {
                switch (tool) {
                    case 'read_file': {
                        const path = String((args as { path: string }).path ?? '');
                        const err = validatePath(path);
                        if (err) return { ok: false, error: err };
                        const tree = deps.getFileTree();
                        // Active editor is fresher for active file
                        const ctx = getActiveEditorContext();
                        if (ctx && ctx.fileName === path) return { ok: true, result: { path, content: ctx.code } };
                        const node = findByPath(tree, path);
                        if (!node || node.type !== 'file') return { ok: false, error: `File not found: ${path}` };
                        return { ok: true, result: { path, content: node.content ?? '' } };
                    }
                    case 'search_files': {
                        const query = String((args as { query?: string }).query ?? '');
                        const max = Number((args as { maxResults?: number }).maxResults ?? 10);
                        if (!query.trim()) return { ok: false, error: 'Empty query' };
                        const tree = deps.getFileTree();
                        const results: Array<{ path: string; snippet: string; line: number }> = [];
                        const qLower = query.toLowerCase();
                        const walk = (nodes: FileNode[], prefix: string) => {
                            for (const n of nodes) {
                                // Synthetic root container (incl. the legacy
                                // placeholder): descend without prefixing it.
                                if (n.id === 'root') {
                                    if (n.children) walk(n.children, '');
                                    continue;
                                }
                                const fullPath = prefix ? `${prefix}/${n.name}` : n.name;
                                if (n.type === 'file' && typeof n.content === 'string') {
                                    const idx = n.content.toLowerCase().indexOf(qLower);
                                    if (idx !== -1) {
                                        const start = Math.max(0, idx - 120);
                                        const end = Math.min(n.content.length, idx + 240);
                                        const snippet = n.content.slice(start, end).replace(/\n/g, ' ').slice(0, 300);
                                        const line = n.content.slice(0, idx).split('\n').length;
                                        results.push({ path: fullPath, snippet, line });
                                        if (results.length >= max) return;
                                    }
                                }
                                if (n.children) walk(n.children, fullPath);
                                if (results.length >= max) return;
                            }
                        };
                        walk(tree, '');
                        return { ok: true, result: { query, hits: results } };
                    }
                    case 'list_files': {
                        const path = String((args as { path?: string }).path ?? '');
                        const tree = deps.getFileTree();
                        const children = listChildren(tree, path);
                        return {
                            ok: true,
                            result: {
                                path: path || '/',
                                entries: children.map(c => ({ name: c.name, type: c.type, id: c.id })),
                            },
                        };
                    }
                    case 'get_editor_context': {
                        const ctx = getActiveEditorContext();
                        if (!ctx) return { ok: true, result: { fileName: null, message: 'No active editor' } };
                        return {
                            ok: true,
                            result: {
                                fileName: ctx.fileName,
                                language: ctx.language,
                                lineCount: ctx.lineCount,
                                cursor: ctx.cursor,
                                selection: ctx.selection,
                                selectionText: ctx.selectionText?.slice(0, 2000) ?? null,
                                codePreview: ctx.code.slice(0, 4000),
                            },
                        };
                    }
                    case 'get_diagnostics': {
                        const path = String((args as { path?: string }).path ?? '');
                        const err = validatePath(path);
                        if (err) return { ok: false, error: err };
                        const tree = deps.getFileTree();
                        const node = findByPath(tree, path);
                        const ctx = getActiveEditorContext();
                        const targetCtx = ctx && ctx.fileName === path ? ctx : null;
                        const code = targetCtx ? targetCtx.code : (node?.content ?? null);
                        if (code === null) return { ok: false, error: `File not found: ${path}` };
                        const { checkCodeErrors } = await import('../../utils/diagnosticsService');
                        const res = await checkCodeErrors(code, path);
                        return { ok: true, result: { path, markers: res.markers.slice(0, 20), isError: res.isError } };
                    }
                    case 'open_file': {
                        const path = String((args as { path?: string }).path ?? '');
                        const err = validatePath(path);
                        if (err) return { ok: false, error: err };
                        const tree = deps.getFileTree();
                        const node = findByPath(tree, path);
                        if (!node || node.type !== 'file') return { ok: false, error: `File not found: ${path}` };
                        if (deps.setActiveFile) deps.setActiveFile(node);
                        return { ok: true, result: { opened: path } };
                    }
                    case 'create_file':
                    case 'rename_file':
                    case 'delete_file':
                    case 'replace_range':
                    case 'insert_text':
                    case 'delete_range':
                    case 'apply_patch':
                    case 'run_code':
                        return { ok: false, error: `Tool ${tool} requires mutation flow via executeActionPlan — use the planning pipeline. For reads use read_file/search/list.` };
                    default:
                        return { ok: false, error: `Unknown tool: ${tool}` };
                }
            } catch (e) {
                return { ok: false, error: (e as Error).message };
            }
        },
    };
    return registry;
}

export function toolDefinitionsForPrompt(): string {
    return TOOL_DEFINITIONS.map(t => `- ${t.name}(${Object.entries(t.parameters).map(([k, v]) => `${k}${v.required ? '' : '?'}:${v.type}`).join(', ')}) — ${t.description}`).join('\n');
}
