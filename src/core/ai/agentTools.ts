/**
 * Agent Tools — the REAL, executable tool surface for the autonomous agent.
 *
 * Every tool here performs an ACTUAL operation through the existing IDE
 * services:
 *   - reads      → `core/filesystem/queries` against the live file tree
 *                   (+ the Monaco model for the active, possibly-unsaved file)
 *   - writes     → `aiToolExecutor.executeActionPlan`, which resolves against
 *                   the latest source, validates deterministically, applies
 *                   atomically, verifies, and rolls back on any failure
 *   - diagnostics→ `utils/diagnosticsService` (the IDE's real checker)
 *
 * There is no second filesystem, no mock implementation, and no simulated
 * result: `executeTool` returns what the underlying service actually did, and a
 * failed write is reported as a failure.
 *
 * SECURITY (Phase 11). The model is untrusted input:
 *   - every path goes through `normalizeResourcePath` (traversal, control
 *     chars, over-long segments rejected);
 *   - every argument is schema-validated in THIS module before dispatch;
 *   - destructive tools (`delete_file`, `rename_file`) are gated by a caller-
 *     supplied confirmation policy — the loop never silently deletes;
 *   - unknown tool names and malformed JSON arguments are rejected, never
 *     coerced.
 */

import type { FileNode } from '../../utils/mockFileSystem';
import { getActiveEditorContext } from '../editor/activeEditorStore';
import { getResourceMetadata, listDirectory, normalizeResourcePath, resolveResource } from '../filesystem/queries';
import type { ExecutorDeps, AIAction, ExecutionResult } from './aiToolExecutor';
import type { AIToolDefinition } from './types';

// ---------------------------------------------------------------------------
// Schema validation (application-side, never delegated to the model)
// ---------------------------------------------------------------------------

export type ToolArgs = Record<string, unknown>;

export interface ToolSchema {
    name: string;
    description: string;
    /** JSON-schema-ish parameter spec sent to the provider. */
    parameters: AIToolDefinition['function']['parameters'];
    /** True when the tool changes the workspace (drives the policy gate). */
    mutating: boolean;
    /** True when the tool removes or replaces existing user data. */
    destructive: boolean;
}

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });

/**
 * The agent's tool catalogue. Stable identifiers — the model dispatches on
 * these names, so they must not change casually.
 */
export const AGENT_TOOL_SCHEMAS: ToolSchema[] = [
    {
        name: 'list_files',
        description: 'List the files and folders at a workspace path. Use an empty path for the workspace root.',
        mutating: false,
        destructive: false,
        parameters: { type: 'object', properties: { path: str('Directory path relative to the workspace root. Empty = root.') }, required: [] },
    },
    {
        name: 'read_file',
        description: 'Read the full content of a workspace file. Use this before editing a file you have not read.',
        mutating: false,
        destructive: false,
        parameters: { type: 'object', properties: { path: str('File path relative to the workspace root.') }, required: ['path'] },
    },
    {
        name: 'search_files',
        description: 'Search all workspace files for a substring. Returns matching paths with line numbers and snippets.',
        mutating: false,
        destructive: false,
        parameters: {
            type: 'object',
            properties: { query: str('Text to search for.'), maxResults: num('Maximum matches to return (default 20).') },
            required: ['query'],
        },
    },
    {
        name: 'get_file_info',
        description: 'Get metadata for a workspace path: type, size, child count, resolved path.',
        mutating: false,
        destructive: false,
        parameters: { type: 'object', properties: { path: str('File or folder path.') }, required: ['path'] },
    },
    {
        name: 'get_diagnostics',
        description: 'Get real syntax/semantic diagnostics for a workspace file.',
        mutating: false,
        destructive: false,
        parameters: { type: 'object', properties: { path: str('File path.') }, required: ['path'] },
    },
    {
        name: 'get_editor_context',
        description: 'Get the live editor state: active file, language, line count, selection, cursor.',
        mutating: false,
        destructive: false,
        parameters: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'create_directory',
        description: 'Create a folder (and any missing parents) at a workspace path.',
        mutating: true,
        destructive: false,
        parameters: { type: 'object', properties: { path: str('Folder path to create.') }, required: ['path'] },
    },
    {
        name: 'create_file',
        description: 'Create a new file with the given content. Parent folders are created as needed.',
        mutating: true,
        destructive: false,
        parameters: {
            type: 'object',
            properties: { path: str('File path to create.'), content: str('Complete file content.') },
            required: ['path'],
        },
    },
    {
        name: 'write_file',
        description: 'Replace the entire content of an existing file.',
        mutating: true,
        destructive: false,
        parameters: {
            type: 'object',
            properties: { path: str('File path to overwrite.'), content: str('Complete new file content.') },
            required: ['path', 'content'],
        },
    },
    {
        name: 'replace_range',
        description: 'Replace a 1-based inclusive line range in a file with new text. Use for surgical edits.',
        mutating: true,
        destructive: false,
        parameters: {
            type: 'object',
            properties: {
                path: str('File path.'),
                startLine: num('First line to replace (1-based, inclusive).'),
                endLine: num('Last line to replace (1-based, inclusive).'),
                content: str('Replacement text for that range.'),
            },
            required: ['path', 'startLine', 'endLine', 'content'],
        },
    },
    {
        name: 'insert_text',
        description: 'Insert text into a file at a 1-based line.',
        mutating: true,
        destructive: false,
        parameters: {
            type: 'object',
            properties: { path: str('File path.'), line: num('Line to insert at (1-based).'), content: str('Text to insert.') },
            required: ['path', 'line', 'content'],
        },
    },
    {
        name: 'delete_range',
        description: 'Delete a 1-based inclusive line range from a file.',
        mutating: true,
        destructive: false,
        parameters: {
            type: 'object',
            properties: { path: str('File path.'), startLine: num('First line (1-based).'), endLine: num('Last line (1-based, inclusive).') },
            required: ['path', 'startLine', 'endLine'],
        },
    },
    {
        name: 'rename_file',
        description: 'Rename an existing file or folder.',
        mutating: true,
        destructive: true,
        parameters: { type: 'object', properties: { path: str('Current path.'), newPath: str('New path.') }, required: ['path', 'newPath'] },
    },
    {
        name: 'delete_file',
        description: 'Delete a file or folder from the workspace. Destructive — only when the user asked.',
        mutating: true,
        destructive: true,
        parameters: { type: 'object', properties: { path: str('Path to delete.') }, required: ['path'] },
    },
];

/** Provider-facing definitions (safe shape: no internal flags). */
export function toolDefinitions(): AIToolDefinition[] {
    return AGENT_TOOL_SCHEMAS.map(t => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

export function toolSchema(name: string): ToolSchema | undefined {
    return AGENT_TOOL_SCHEMAS.find(t => t.name === name);
}

/**
 * Parse a tool call's `arguments` string.
 *
 * Malformed JSON is an INVALID call — it is never partially recovered with
 * regex, and never treated as an empty argument object (which would silently
 * run a tool with defaults the model never chose).
 */
export function parseToolArguments(raw: unknown): ToolArgs | null {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw === 'object') return raw as ToolArgs;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as ToolArgs;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Argument validation — enforced in application code, not by the prompt
// ---------------------------------------------------------------------------

export interface ValidatedArgs {
    ok: true;
    args: ToolArgs;
} 
export interface InvalidArgs {
    ok: false;
    error: string;
}

function requireString(args: ToolArgs, key: string): string | null {
    const v = args[key];
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length ? t : null;
}

function requireNumber(args: ToolArgs, key: string): number | null {
    const v = args[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
}

/**
 * Validate + normalize arguments for a tool.
 *
 * Path validation is mandatory for every tool that takes a path: traversal,
 * control characters and over-long segments are rejected here, so a hostile or
 * confused model cannot escape the workspace.
 */
export function validateToolArgs(tool: string, args: ToolArgs): ValidatedArgs | InvalidArgs {
    const schema = toolSchema(tool);
    if (!schema) return { ok: false, error: `Unknown tool: ${tool}` };

    const out: ToolArgs = {};

    if (tool === 'list_files') {
        const raw = args.path;
        if (raw !== undefined && typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
        if (raw === undefined || String(raw).trim() === '') {
            out.path = '';
        } else {
            const norm = normalizeResourcePath(raw, { allowEmpty: true });
            if (!norm.ok) return { ok: false, error: norm.error };
            out.path = norm.path;
        }
        return { ok: true, args: out };
    }

    if (tool === 'get_editor_context') return { ok: true, args: {} };

    if (tool === 'search_files') {
        const q = requireString(args, 'query');
        if (!q) return { ok: false, error: 'search_files requires a non-empty query' };
        const max = requireNumber(args, 'maxResults');
        out.query = q;
        out.maxResults = max && max > 0 ? Math.min(Math.floor(max), 50) : 20;
        return { ok: true, args: out };
    }

    const pathKey = 'path';
    const path = requireString(args, pathKey);
    if (!path) return { ok: false, error: `${tool} requires a non-empty path` };
    const norm = normalizeResourcePath(path);
    if (!norm.ok) return { ok: false, error: norm.error };
    out.path = norm.path;

    switch (tool) {
        case 'read_file':
        case 'get_file_info':
        case 'get_diagnostics':
        case 'delete_file':
        case 'create_directory':
            return { ok: true, args: out };

        case 'create_file': {
            const content = args.content;
            if (content !== undefined && typeof content !== 'string') return { ok: false, error: 'content must be a string' };
            if (typeof content === 'string' && content.length > MAX_TOOL_CONTENT_CHARS) {
                return { ok: false, error: `content exceeds the ${MAX_TOOL_CONTENT_CHARS} character limit for a single tool call` };
            }
            out.content = typeof content === 'string' ? content : '';
            return { ok: true, args: out };
        }
        case 'write_file': {
            const content = args.content;
            if (typeof content !== 'string') return { ok: false, error: 'write_file requires content (string)' };
            if (content.length > MAX_TOOL_CONTENT_CHARS) {
                return { ok: false, error: `content exceeds the ${MAX_TOOL_CONTENT_CHARS} character limit for a single tool call` };
            }
            out.content = content;
            return { ok: true, args: out };
        }
        case 'replace_range': {
            const s = requireNumber(args, 'startLine');
            const e = requireNumber(args, 'endLine');
            if (s === null || e === null) return { ok: false, error: 'replace_range requires numeric startLine and endLine' };
            if (s < 1 || e < s) return { ok: false, error: `Invalid range ${s}..${e} (startLine must be >= 1 and <= endLine)` };
            if (e - s > MAX_TOOL_LINE_SPAN) return { ok: false, error: `Range spans more than ${MAX_TOOL_LINE_SPAN} lines` };
            if (typeof args.content !== 'string') return { ok: false, error: 'replace_range requires content (string)' };
            if (args.content.length > MAX_TOOL_CONTENT_CHARS) {
                return { ok: false, error: `content exceeds the ${MAX_TOOL_CONTENT_CHARS} character limit for a single tool call` };
            }
            out.startLine = Math.floor(s);
            out.endLine = Math.floor(e);
            out.content = args.content;
            return { ok: true, args: out };
        }
        case 'insert_text': {
            const line = requireNumber(args, 'line');
            if (line === null) return { ok: false, error: 'insert_text requires a numeric line' };
            if (line < 1) return { ok: false, error: `Invalid line: ${line}` };
            if (typeof args.content !== 'string') return { ok: false, error: 'insert_text requires content (string)' };
            if (args.content.length > MAX_TOOL_CONTENT_CHARS) {
                return { ok: false, error: `content exceeds the ${MAX_TOOL_CONTENT_CHARS} character limit for a single tool call` };
            }
            out.line = Math.floor(line);
            out.content = args.content;
            return { ok: true, args: out };
        }
        case 'delete_range': {
            const s = requireNumber(args, 'startLine');
            const e = requireNumber(args, 'endLine');
            if (s === null || e === null) return { ok: false, error: 'delete_range requires numeric startLine and endLine' };
            if (s < 1 || e < s) return { ok: false, error: `Invalid range ${s}..${e}` };
            if (e - s > MAX_TOOL_LINE_SPAN) return { ok: false, error: `Range spans more than ${MAX_TOOL_LINE_SPAN} lines` };
            out.startLine = Math.floor(s);
            out.endLine = Math.floor(e);
            return { ok: true, args: out };
        }
        case 'rename_file': {
            const newPath = requireString(args, 'newPath');
            if (!newPath) return { ok: false, error: 'rename_file requires a non-empty newPath' };
            const n = normalizeResourcePath(newPath);
            if (!n.ok) return { ok: false, error: n.error };
            out.newPath = n.path;
            return { ok: true, args: out };
        }
        default:
            return { ok: false, error: `Unknown tool: ${tool}` };
    }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ToolResult {
    ok: boolean;
    /** Compact, model-readable payload. */
    data: Record<string, unknown>;
    /** Present when `ok` is false — the real reason, never fabricated. */
    error?: string;
    /** True when the operation needs explicit user approval before running. */
    requiresApproval?: boolean;
}

/**
 * Bound on a single model tool call.
 *
 * A model that forgets it is inside an IDE can emit an unbounded argument
 * (a 50MB file body, a 100k-line range). These caps are enforced in
 * application code BEFORE execution so a pathological call cannot exhaust
 * memory or blow past the server's per-message content limit.
 */
export const MAX_TOOL_CONTENT_CHARS = 200_000;
export const MAX_TOOL_LINE_SPAN = 100_000;

export interface AgentToolDeps {
    /** Fresh file tree (authoritative workspace state). */
    getFileTree: () => FileNode[];
    /** Executor deps for real mutations (resolve → validate → apply → verify). */
    deps: ExecutorDeps;
    /**
     * Approval policy for destructive tools. Returns true to ALLOW the tool.
     * The loop never proceeds on a destructive tool without an explicit true.
     */
    confirmDestructive?: (tool: string, args: ToolArgs) => boolean | Promise<boolean>;
    /** Optional cancellation check before each tool runs. */
    isCancelled?: () => boolean;
    /**
     * Folder creation, bound to `ProjectContext.createNestedFolders`. Folder
     * creation is not part of `ExecutorDeps` (which is file-oriented), so it
     * is supplied by the caller rather than duplicated here.
     */
    createDirectory?: (path: string) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
}

const MAX_READ_CHARS = 20_000;

function collectFiles(nodes: FileNode[], prefix: string, out: Array<{ path: string; name: string; content: string }>) {
    for (const node of nodes) {
        if (node.id === 'root') {
            if (node.children) collectFiles(node.children, '', out);
            continue;
        }
        const full = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === 'file') out.push({ path: full, name: node.name, content: typeof node.content === 'string' ? node.content : '' });
        if (node.children) collectFiles(node.children, full, out);
    }
}

/** Map a validated tool call onto the existing executor action vocabulary. */
function toolToAction(tool: string, args: ToolArgs): AIAction | null {
    switch (tool) {
        case 'create_file':
            return { action: 'create_file', path: String(args.path), content: String(args.content ?? '') };
        case 'write_file':
            return { action: 'update_file', path: String(args.path), content: String(args.content) };
        case 'replace_range':
            return {
                action: 'replace_code',
                path: String(args.path),
                startLine: Number(args.startLine),
                endLine: Number(args.endLine),
                content: String(args.content),
            };
        case 'insert_text':
            return { action: 'insert_code', path: String(args.path), line: Number(args.line), content: String(args.content) };
        case 'delete_range':
            return { action: 'delete_code', path: String(args.path), startLine: Number(args.startLine), endLine: Number(args.endLine) };
        case 'rename_file':
            return { action: 'rename_file', path: String(args.path), newPath: String(args.newPath) };
        case 'delete_file':
            return { action: 'delete_file', path: String(args.path) };
        default:
            return null;
    }
}

/**
 * Execute ONE validated tool call.
 *
 * Mutations run through `executeActionPlan`, so they get the same
 * resolve-against-latest-source, deterministic validation, atomic apply,
 * post-write verification and rollback guarantees as every other AI edit path
 * in the product. A failed write is reported as a failure — this function
 * never reports success for an operation that did not happen.
 */
export async function executeTool(
    tool: string,
    rawArgs: ToolArgs,
    deps: AgentToolDeps,
): Promise<ToolResult> {
    if (deps.isCancelled?.()) {
        return { ok: false, data: {}, error: 'Cancelled' };
    }

    const schema = toolSchema(tool);
    if (!schema) {
        return { ok: false, data: {}, error: `Unknown tool: ${tool}` };
    }

    const validated = validateToolArgs(tool, rawArgs);
    if (!validated.ok) {
        return { ok: false, data: {}, error: validated.error };
    }
    const args = validated.args;

    const tree = deps.getFileTree();

    // ---- read-only tools -------------------------------------------------
    if (tool === 'list_files') {
        const children = listDirectory(tree, args.path);
        return {
            ok: true,
            data: {
                path: args.path || '/',
                entries: children.map(c => ({ name: c.name, type: c.type, childCount: Array.isArray(c.children) ? c.children.length : 0 })),
            },
        };
    }

    if (tool === 'read_file') {
        // Monaco is fresher than the tree for the active file (unsaved edits).
        const ctx = getActiveEditorContext();
        if (ctx && (ctx.filePath === args.path || ctx.fileName === args.path)) {
            return { ok: true, data: { path: args.path, content: ctx.code.slice(0, MAX_READ_CHARS), truncated: ctx.code.length > MAX_READ_CHARS, source: 'editor' } };
        }
        const node = resolveResource(tree, args.path);
        if (!node || node.type !== 'file') {
            return { ok: false, data: {}, error: `File not found: ${args.path}` };
        }
        const content = typeof node.content === 'string' ? node.content : '';
        return { ok: true, data: { path: args.path, content: content.slice(0, MAX_READ_CHARS), truncated: content.length > MAX_READ_CHARS } };
    }

    if (tool === 'search_files') {
        const query = String(args.query).toLowerCase();
        const max = Number(args.maxResults ?? 20);
        const files: Array<{ path: string; name: string; content: string }> = [];
        collectFiles(tree, '', files);
        const hits: Array<{ path: string; line: number; snippet: string }> = [];
        for (const f of files) {
            if (hits.length >= max) break;
            const lower = f.content.toLowerCase();
            let from = 0;
            while (hits.length < max) {
                const idx = lower.indexOf(query, from);
                if (idx === -1) break;
                const line = f.content.slice(0, idx).split('\n').length;
                const snippet = f.content.slice(Math.max(0, idx - 60), idx + 140).replace(/\n/g, ' ');
                hits.push({ path: f.path, line, snippet });
                from = idx + Math.max(1, query.length);
            }
        }
        return { ok: true, data: { query: args.query, hits, totalFilesSearched: files.length } };
    }

    if (tool === 'get_file_info') {
        const meta = getResourceMetadata(tree, args.path);
        if (!meta) return { ok: false, data: {}, error: `Path not found: ${args.path}` };
        return { ok: true, data: { ...meta } };
    }

    if (tool === 'get_diagnostics') {
        const ctx = getActiveEditorContext();
        let code: string | null = null;
        if (ctx && (ctx.filePath === args.path || ctx.fileName === args.path)) code = ctx.code;
        if (code === null) {
            const node = resolveResource(tree, args.path);
            if (!node || node.type !== 'file') return { ok: false, data: {}, error: `File not found: ${args.path}` };
            code = typeof node.content === 'string' ? node.content : '';
        }
        const { checkCodeErrors } = await import('../../utils/diagnosticsService');
        const res = await checkCodeErrors(code, args.path as string);
        return {
            ok: true,
            data: {
                path: args.path,
                isError: res.isError,
                markers: res.markers.slice(0, 20).map((m: { message?: string; line?: number }) => ({ message: m.message, line: m.line })),
            },
        };
    }

    if (tool === 'get_editor_context') {
        const ctx = getActiveEditorContext();
        if (!ctx) return { ok: true, data: { fileName: null, message: 'No active editor' } };
        return {
            ok: true,
            data: {
                fileName: ctx.fileName,
                filePath: ctx.filePath,
                language: ctx.language,
                lineCount: ctx.lineCount,
                cursor: ctx.cursor,
                selection: ctx.selection,
                selectionText: ctx.selectionText?.slice(0, 2000) ?? null,
                codePreview: ctx.code.slice(0, 4000),
            },
        };
    }

    // ---- create_directory ------------------------------------------------
    if (tool === 'create_directory') {
        const node = resolveResource(tree, args.path);
        if (node && node.type === 'folder') {
            return { ok: true, data: { path: args.path, created: false, note: 'Directory already exists' } };
        }
        if (node && node.type === 'file') {
            return { ok: false, data: {}, error: `A file already exists at ${args.path}` };
        }
        // Directories are created by the authoritative filesystem operation
        // via the workspace's own folder-creation path, not by the agent.
        const created = await createDirectoryInWorkspace(deps, String(args.path));
        if (!created.ok) return { ok: false, data: {}, error: created.error };
        return { ok: true, data: { path: args.path, created: true } };
    }

    // ---- mutating tools --------------------------------------------------
    if (schema.destructive) {
        const allowed = deps.confirmDestructive ? await deps.confirmDestructive(tool, args) : false;
        if (!allowed) {
            return {
                ok: false,
                data: {},
                error: `${tool} was not approved. Ask the user to confirm before deleting or renaming.`,
                requiresApproval: true,
            };
        }
    }

    if (deps.isCancelled?.()) {
        return { ok: false, data: {}, error: 'Cancelled' };
    }

    const action = toolToAction(tool, args);
    if (!action) return { ok: false, data: {}, error: `Tool ${tool} is not executable` };

    // Guard: writing to a path outside the workspace, or to a folder, fails
    // here rather than corrupting the tree.
    if (tool === 'delete_file' || tool === 'write_file' || tool === 'rename_file' || tool === 'replace_range' || tool === 'insert_text' || tool === 'delete_range') {
        const target = resolveResource(tree, args.path);
        if (!target) {
            return { ok: false, data: {}, error: `File not found: ${args.path}` };
        }
        if (target.type !== 'file') {
            return { ok: false, data: {}, error: `${args.path} is a ${target.type}, not a file` };
        }
    }

    const execution: ExecutionResult = await executeViaBridge([action], deps);

    if (!execution.success) {
        return { ok: false, data: {}, error: execution.message };
    }
    if (execution.appliedCount === 0) {
        return { ok: true, data: { path: args.path, applied: false, note: execution.message } };
    }
    return { ok: true, data: { path: args.path, applied: true, note: execution.message } };
}

/**
 * Execute a plan through the executor. `executeActionPlan` is imported lazily
 * to keep this module free of a circular import with `aiToolExecutor` types.
 */
async function executeViaBridge(actions: AIAction[], deps: AgentToolDeps): Promise<ExecutionResult> {
    const { executeActionPlan } = await import('./aiToolExecutor');
    return executeActionPlan(actions, deps.deps, { language: null });
}

/**
 * Create a folder through the workspace's authoritative path.
 * `ExecutorDeps` intentionally exposes only file operations; folder creation
 * goes through the caller-provided hook bound to `ProjectContext.createFolder`.
 */
async function createDirectoryInWorkspace(deps: AgentToolDeps, path: string): Promise<{ ok: boolean; error?: string }> {
    if (!deps.createDirectory) {
        return { ok: false, error: 'Creating directories is not available in this session' };
    }
    return deps.createDirectory(path);
}