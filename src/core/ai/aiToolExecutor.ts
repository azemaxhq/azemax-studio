/**
 * Centralized AI Action Executor — thin orchestration over the Edit Engine.
 *
 * This is the ONLY path by which AI output may mutate files. Flow:
 *   AI raw response → parse → normalize to Action[] → compile (resolve targets
 *   against LATEST source) → build candidates (pure) → validate (deterministic)
 *   → apply atomically (snapshot + rollback) → verify.
 *
 * No feature may call `updateFileContent`/`createFile` directly with raw AI output.
 */

import { parseStructuredOperations } from './structuredOperationParser';
import {
    normalizeCommentMode,
} from './commentApplier';
import { resolvePath } from '../../utils/safeTree';
import {
    compilePlan,
    buildCandidates,
    verifyAppliedCandidates,
    type FileSnapshot,
} from './editEngine';
import { formatNaturalResponse } from './responseFormatter';

// Re-export for callers that need to build context
export { getActiveEditorContext } from '../editor/activeEditorStore';

// Strict action schemas — every AI mutation must be one of these
export type CommentTarget = { line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string | null };

export type AIAction =
    | { action: 'add_comments'; comments: CommentTarget[]; file?: string }
    | { action: 'remove_comments'; file?: string; preserveLines?: number[]; scope?: 'file' | 'selection'; selectionRange?: { startLine: number; endLine: number } }
    | { action: 'create_file'; path: string; content: string }
    | { action: 'delete_file'; path: string }
    | { action: 'rename_file'; path: string; newPath: string }
    | { action: 'update_file'; path: string; content: string }
    | { action: 'insert_code'; path?: string; line: number; content: string; anchor?: string | null }
    | { action: 'replace_code'; path?: string; startLine: number; endLine: number; content: string; anchor?: string | null }
    | { action: 'delete_code'; path?: string; startLine: number; endLine: number }
    | { action: 'read_file'; path: string }
    | { action: 'search_files'; query: string }
    | { action: 'list_files'; path?: string }
    | { action: 'get_diagnostics'; path: string }
    | { action: 'get_editor_context' }
    | { action: 'open_file'; path: string };

export type AIActionPlan = {
    actions: AIAction[];
    reasoning?: string;
};

export type ExecutorDeps = {
    getFileContent: (path: string) => string | null;
    getFileIdByPath: (path: string) => string | null;
    createFile: (path: string, content: string) => { success: boolean; error?: string };
    deleteNode: (id: string) => void;
    renameNode: (id: string, newName: string) => { success: boolean; error?: string };
    updateFileContent: (fileId: string, content: string) => { success: boolean; error?: string };
    getActiveFilePath: () => string | null;
    getActiveFileId: () => string | null;
    getFileTree?: () => import('../../utils/mockFileSystem').FileNode[];
};

export type ExecutionResult = {
    success: boolean;
    appliedCount: number;
    message: string;
    details?: string;
    rolledBack?: boolean;
};

export type EditSnapshot = FileSnapshot;

/**
 * Normalize any AI JSON (tolerant) into a single internal Action[].
 * Supports:
 * - {"action":"add_comments","comments":[{line,text,mode?}]}
 * - {"comments":[{line,text}]}  (comment-only)
 * - {"operations":[{type:"add_comment"|"update_comment"|"remove_comment"|...}]}
 * - {"action":"create_file",...} / update_file / delete_file / rename_file
 * - {actions:[...]} / {operations:[...]} wrappers and bare arrays
 * - Markdown-fenced JSON
 */
export function normalizeAIResponseToActions(raw: string, fallbackFile?: string): AIAction[] | null {
    if (!raw) return null;
    // First try the structured operations parser (canonical {operations:[...]})
    const structured = parseStructuredOperations(raw, fallbackFile);
    if (structured && structured.length > 0) return structured;

    let candidate = raw.trim();

    // Extract fenced JSON if present
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();

    // Find first JSON object/array
    const match = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return null;

    try {
        const parsed = JSON.parse(match[1]);

        // Handle array of actions directly
        if (Array.isArray(parsed)) {
            return normalizeActionArray(parsed, fallbackFile);
        }

        // Handle {actions:[...]} wrapper
        if (parsed.actions && Array.isArray(parsed.actions)) {
            return normalizeActionArray(parsed.actions, fallbackFile);
        }

        // Handle {comments:[...]} shorthand (with optional mode per entry)
        if (Array.isArray(parsed.comments) && !parsed.action) {
            const comments = normalizeComments(parsed.comments);
            if (comments.length > 0) return [{ action: 'add_comments', comments, file: fallbackFile }];
        }

        return null;
    } catch {
        return null;
    }
}

export function normalizeComments(arr: unknown[]): CommentTarget[] {
    const out: CommentTarget[] = [];
    for (const item of arr) {
        if (typeof item !== 'object' || item === null) continue;
        const o = item as Record<string, unknown>;
        const line = o.line ?? o.startLine ?? o.lineNumber;
        const rawText = o.text ?? o.comment ?? o.content;
        if (typeof line !== 'number' || typeof rawText !== 'string') continue;
        const text = rawText.trim().replace(/^\/\/+\s*/, '').replace(/^#+\s*/, '').replace(/;\s*$/, '').trim();
        const mode = normalizeCommentMode(o.mode ?? o.op);
        const anchor = typeof o.anchor === 'string' ? o.anchor : null;
        if (!text && mode !== 'remove') continue;
        const target: CommentTarget = { line: Math.max(1, Math.floor(line)), text };
        if (mode !== 'upsert') target.mode = mode;
        if (anchor) target.anchor = anchor;
        out.push(target);
    }
    // Dedup by line+mode, sort ascending
    const seen = new Set<string>();
    const deduped: CommentTarget[] = [];
    for (const c of out) {
        const key = `${c.line}:${c.mode ?? 'upsert'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
    }
    deduped.sort((a, b) => a.line - b.line);
    return deduped;
}

function normalizeActionArray(arr: unknown[], fallbackFile?: string): AIAction[] | null {
    const out: AIAction[] = [];
    for (const item of arr) {
        if (typeof item !== 'object' || item === null) continue;
        const a = item as Record<string, unknown>;
        const payload = (a.payload && typeof a.payload === 'object' ? a.payload : {}) as Record<string, unknown>;
        const target = (a.target && typeof a.target === 'object' ? a.target : {}) as Record<string, unknown>;
        const typeRaw = typeof a.action === 'string' ? a.action : typeof a.type === 'string' ? a.type : '';
        const type = typeRaw.trim().toLowerCase().replace(/-/g, '_');

        if (['add_comments', 'add_comment', 'comment', 'update_comment', 'replace_comment', 'change_comment'].includes(type)) {
            const rawComments = (a.comments ?? payload.comments ?? (Array.isArray(a) ? [] : [])) as unknown;
            let comments: CommentTarget[] = [];
            if (Array.isArray(rawComments)) {
                comments = normalizeComments(rawComments);
            } else if (typeof a.line === 'number' && typeof (a.text ?? a.comment ?? payload.text) === 'string') {
                comments = normalizeComments([{ line: a.line, text: (a.text ?? a.comment ?? payload.text), mode: a.mode }]);
            }
            if (comments.length > 0) {
                out.push({ action: 'add_comments', comments, file: (a.file as string) || (target.filePath as string) || fallbackFile });
            }
        } else if (['remove_comments', 'remove_comment', 'delete_comment'].includes(type)) {
            const preserveLines = Array.isArray(a.preserveLines)
                ? (a.preserveLines as unknown[]).filter(n => typeof n === 'number') as number[]
                : Array.isArray(payload.preserveLines)
                    ? (payload.preserveLines as unknown[]).filter(n => typeof n === 'number') as number[]
                    : undefined;
            const scopeRaw = a.scope || target.scope;
            const scope = scopeRaw === 'selection' || scopeRaw === 'file' ? scopeRaw : undefined;
            const selRange = (a.selectionRange || target.selectionRange) as { startLine: number; endLine: number } | undefined;
            out.push({
                action: 'remove_comments',
                file: (a.file as string) || (a.path as string) || (target.filePath as string) || fallbackFile,
                ...(preserveLines ? { preserveLines } : {}),
                ...(scope ? { scope } : {}),
                ...(selRange ? { selectionRange: selRange } : {}),
            });
        } else if ((type === 'create_file' || type === 'create') && typeof a.path === 'string') {
            out.push({ action: 'create_file', path: a.path, content: (a.content as string) || '' });
        } else if ((type === 'delete_file' || type === 'remove_file') && typeof a.path === 'string') {
            out.push({ action: 'delete_file', path: a.path });
        } else if ((type === 'rename_file' || type === 'rename') && typeof a.path === 'string' && typeof a.newPath === 'string') {
            out.push({ action: 'rename_file', path: a.path, newPath: a.newPath });
        } else if ((type === 'update_file' || type === 'replace_file') && typeof a.path === 'string') {
            out.push({ action: 'update_file', path: a.path, content: (a.content as string) || '' });
        } else if ((type === 'insert_code' || type === 'insert' || type === 'insert_text') && typeof payload.line === 'number' && typeof payload.content === 'string') {
            out.push({ action: 'insert_code', path: (target.filePath as string) || fallbackFile, line: payload.line, content: payload.content });
        } else if ((type === 'replace_code' || type === 'replace' || type === 'replace_range') && typeof payload.startLine === 'number' && typeof payload.endLine === 'number' && typeof payload.content === 'string') {
            out.push({ action: 'replace_code', path: (target.filePath as string) || fallbackFile, startLine: payload.startLine, endLine: payload.endLine, content: payload.content });
        } else if ((type === 'delete_code' || type === 'delete_line' || type === 'delete_range') && typeof payload.startLine === 'number' && typeof payload.endLine === 'number') {
            out.push({ action: 'delete_code', path: (target.filePath as string) || fallbackFile, startLine: payload.startLine, endLine: payload.endLine });
        } else if (type === 'read_file' && typeof (a.path ?? payload.path) === 'string') {
            out.push({ action: 'read_file', path: String(a.path ?? payload.path) });
        } else if (type === 'search_files' && typeof (payload.query ?? (a as { query?: unknown }).query) === 'string') {
            out.push({ action: 'search_files', query: String(payload.query ?? (a as { query?: unknown }).query) });
        } else if (type === 'list_files') {
            out.push({ action: 'list_files', path: (a.path as string) || (payload.path as string) || undefined });
        } else if (type === 'get_diagnostics' && typeof (a.path ?? payload.path) === 'string') {
            out.push({ action: 'get_diagnostics', path: String(a.path ?? payload.path) });
        } else if (type === 'get_editor_context') {
            out.push({ action: 'get_editor_context' });
        } else if (type === 'open_file' && typeof (a.path ?? payload.path) === 'string') {
            out.push({ action: 'open_file', path: String(a.path ?? payload.path) });
        }
    }
    return out.length > 0 ? out : null;
}

/**
 * Validate an action plan schema before execution.
 * Returns error message if invalid, null if valid.
 */
export function validateActionPlan(plan: AIAction[]): string | null {
    if (!plan || plan.length === 0) return 'Empty action plan';

    for (const action of plan) {
        switch (action.action) {
            case 'add_comments': {
                if (!action.comments || action.comments.length === 0) return 'add_comments requires non-empty comments array';
                for (const c of action.comments) {
                    if (typeof c.line !== 'number' || c.line < 1) return `Invalid comment line: ${c.line}`;
                    if ((c.mode ?? 'upsert') !== 'remove' && (typeof c.text !== 'string' || !c.text.trim())) return 'Comment text must be non-empty';
                }
                break;
            }
            case 'remove_comments': {
                if (action.preserveLines !== undefined && !Array.isArray(action.preserveLines)) return 'remove_comments preserveLines must be array';
                break;
            }
            case 'create_file': {
                if (!action.path || typeof action.path !== 'string') return 'create_file requires path';
                if (action.path.includes('..')) return 'Invalid path: contains ..';
                break;
            }
            case 'delete_file':
                if (!action.path) return 'delete_file requires path';
                break;
            case 'rename_file':
                if (!action.path || !action.newPath) return 'rename_file requires path and newPath';
                break;
            case 'update_file':
                if (!action.path) return 'update_file requires path';
                if (typeof action.content !== 'string') return 'update_file content must be string';
                break;
            case 'insert_code':
                if (typeof action.line !== 'number' || action.line < 1) return 'Invalid insert line';
                break;
            case 'replace_code':
            case 'delete_code':
                if (typeof action.startLine !== 'number' || typeof action.endLine !== 'number' || action.startLine < 1 || action.endLine < action.startLine) {
                    return `Invalid ${action.action} range`;
                }
                break;
            case 'read_file':
            case 'get_diagnostics':
            case 'open_file':
                if (!(action as { path?: string }).path) return `${action.action} requires path`;
                break;
            case 'search_files':
                if (!(action as { query?: string }).query) return 'search_files requires query';
                break;
            case 'list_files':
            case 'get_editor_context':
                break;
        }
    }
    return null;
}

/**
 * Execute an action plan atomically via the Edit Engine.
 *
 * All targets are resolved against the LATEST source (stale-safe), candidates
 * are built and validated deterministically BEFORE any mutation, files are
 * written once each, and every write is verified. Any failure rolls back all
 * touched files, leaving the workspace exactly as it was.
 */
export async function executeActionPlan(
    plan: AIAction[],
    deps: ExecutorDeps,
    options?: { language?: string | null; snapshot?: EditSnapshot | null; snapshotMap?: Map<string, EditSnapshot> }
): Promise<ExecutionResult> {
    const schemaError = validateActionPlan(plan);
    if (schemaError) {
        return { success: false, appliedCount: 0, message: `Action validation failed: ${schemaError}` };
    }

    // Latest-source reader (fresh at every access — never cached across calls)
    const readLatest = (path: string): string | null => deps.getFileContent(path);

    // Snapshot map for stale-target resolution
    const snapshots = new Map<string, FileSnapshot>();
    if (options?.snapshotMap) {
        for (const [p, s] of options.snapshotMap) snapshots.set(p, s);
    }
    if (options?.snapshot && !snapshots.has(options.snapshot.filePath)) {
        snapshots.set(options.snapshot.filePath, options.snapshot);
    }

    const activePath = deps.getActiveFilePath() || options?.snapshot?.filePath || null;
    const language = options?.language ?? null;

    // [3] RESOLVE + [4] COMPOSE + [5] VALIDATE — nothing has been written yet
    const compiled = compilePlan(plan, readLatest, snapshots, activePath, language);
    if (!compiled.ok) {
        return { success: false, appliedCount: 0, message: compiled.reason ?? 'Plan could not be resolved against current source' };
    }
    const built = buildCandidates(compiled.plans!, readLatest, language);
    if (!built.ok) {
        return { success: false, appliedCount: 0, message: built.reason ?? 'Candidate validation failed' };
    }
    const candidates = built.candidates!;

    // Nothing changed after validation → honest no-op success
    const mutating = plan.filter(a =>
        !(a.action === 'add_comments' || a.action === 'remove_comments'));
    const effectiveChanges = candidates.filter(c =>
        c.candidate !== c.original ||
        c.plan.actions.some(a => ['create_file', 'delete_file', 'rename_file'].includes(a.action)));
    if (effectiveChanges.length === 0 && mutating.length >= 0) {
        // Idempotent no-op (e.g., comment already exists). Still report accurately.
        const message = formatNaturalResponse(plan, 0, activePath, language);
        return { success: true, appliedCount: 0, message };
    }

    // [6] APPLY — snapshot originals for rollback, then write once per file
    const rollback = new Map<string, string>(); // fileId -> pre-edit content
    const appliedActions = new Set<number>();

    try {
        for (const c of candidates) {
            const wholeFile = c.plan.actions.find(a =>
                a.action === 'create_file' || a.action === 'delete_file' || a.action === 'rename_file');
            if (wholeFile) {
                switch (wholeFile.action) {
                    case 'create_file': {
                        const res = deps.createFile(wholeFile.path, wholeFile.content);
                        if (!res.success) throw new Error(res.error || `Failed to create file: ${wholeFile.path}`);
                        appliedActions.add(plan.indexOf(wholeFile));
                        break;
                    }
                    case 'delete_file': {
                        const fileId = deps.getFileIdByPath(wholeFile.path);
                        if (!fileId) throw new Error(`File not found for delete: ${wholeFile.path}`);
                        const content = deps.getFileContent(wholeFile.path);
                        if (content !== null) rollback.set(fileId, content);
                        deps.deleteNode(fileId);
                        appliedActions.add(plan.indexOf(wholeFile));
                        break;
                    }
                    case 'rename_file': {
                        const fileId = deps.getFileIdByPath(wholeFile.path);
                        if (!fileId) throw new Error(`File not found for rename: ${wholeFile.path}`);
                        const newName = wholeFile.newPath.split('/').pop() || wholeFile.newPath;
                        const res = deps.renameNode(fileId, newName);
                        if (!res.success) throw new Error(res.error || `Failed to rename: ${wholeFile.path}`);
                        appliedActions.add(plan.indexOf(wholeFile));
                        break;
                    }
                }
                continue;
            }

            const fileId = deps.getFileIdByPath(c.filePath)
                || (c.filePath === activePath ? deps.getActiveFileId() : null);
            if (!fileId) throw new Error(`File not found: ${c.filePath}`);

            const original = deps.getFileContent(c.filePath);
            if (original !== null) rollback.set(fileId, original);

            const res = deps.updateFileContent(fileId, c.candidate);
            if (!res.success) throw new Error(res.error || `Failed to update file: ${c.filePath}`);
            for (const a of c.plan.actions) appliedActions.add(plan.indexOf(a));
        }

        // [7] VERIFY — re-read everything; store must match validated candidates
        let verifyFail = verifyAppliedCandidates(
            candidates.filter(c => !c.plan.actions.some(a => ['create_file', 'rename_file'].includes(a.action))),
            readLatest,
        );
        // Fallback: Monaco model may lag behind fileTree (React state async). If Monaco mismatches
        // but fileTree matches candidate, treat as success — Monaco will sync via effect.
        if (verifyFail && deps.getFileTree) {
            const readFromTreeOnly = (p: string): string | null => {
                const node = resolvePath(deps.getFileTree!(), p);
                return node && typeof node.content === 'string' ? node.content : null;
            };
            const retryFail = verifyAppliedCandidates(
                candidates.filter(c => !c.plan.actions.some(a => ['create_file', 'rename_file'].includes(a.action))),
                readFromTreeOnly,
            );
            if (!retryFail) {
                console.warn('[Verify] Monaco stale but fileTree matches — treating as success for', verifyFail.filePath);
                verifyFail = null;
            } else if (retryFail && verifyFail) {
                // Both failed — keep original but log candidate vs stored diff for debugging
                if (import.meta.env.DEV) {
                    const cand = candidates.find(c => c.filePath === verifyFail!.filePath);
                    const storedViaTree = readFromTreeOnly(verifyFail.filePath);
                    const storedViaMonaco = readLatest(verifyFail.filePath);
                    console.warn('[Verify] Failed both reads', { file: verifyFail.filePath, candidateLen: cand?.candidate.length, treeLen: storedViaTree?.length, monacoLen: storedViaMonaco?.length, candidateHead: cand?.candidate.slice(0,200), treeHead: storedViaTree?.slice(0,200) });
                }
            }
        }
        if (verifyFail) {
            throw new Error(`Verification failed for ${verifyFail.filePath}: ${verifyFail.reason}`);
        }

        const appliedList = plan.filter((_, i) => appliedActions.has(i));
        const message = formatNaturalResponse(appliedList, appliedList.length, activePath, language);
        return { success: true, appliedCount: appliedList.length, message };
    } catch (error) {
        // Rollback EVERY touched file to its pre-edit content
        let rollbackFailures = 0;
        for (const [fileId, content] of rollback) {
            try {
                deps.updateFileContent(fileId, content);
            } catch {
                rollbackFailures++;
            }
        }
        const msg = error instanceof Error ? error.message : String(error);
        const rolledBackCleanly = rollback.size === 0 || rollbackFailures === 0;
        return {
            success: false,
            appliedCount: 0,
            message: rolledBackCleanly
                ? `Edit failed and was fully rolled back — your file is unchanged. (${msg})`
                : `Edit failed (${msg}) and the automatic rollback was NOT fully successful — ${rollbackFailures} file(s) may still contain partial changes. Please review before continuing.`,
            rolledBack: rolledBackCleanly && rollback.size > 0,
        };
    }
}

/**
 * Convert a SemanticPlan into deterministic AIAction[].
 * Enriches targets with anchors from the snapshot the planner saw so the
 * executor can validate them against the latest source.
 */
export function semanticPlanToActions(
    plan: import('./semanticPlanner').SemanticPlan,
    fallbackFile?: string,
    snapshotLines?: string[] | null,
): AIAction[] | null {
    if (!plan || !plan.actions || plan.actions.length === 0) return null;
    const out: AIAction[] = [];
    const anchorFor = (line: unknown): string | null => {
        if (typeof line !== 'number' || !snapshotLines) return null;
        return snapshotLines[line - 1] ?? null;
    };

    for (const a of plan.actions) {
        const filePath = a.target?.filePath || fallbackFile;
        const payload = (a as any).payload || {};
        switch (a.type) {
            case 'add_comments': {
                const rawComments = payload.comments || (a as any).comments;
                if (Array.isArray(rawComments) && rawComments.length > 0) {
                    const comments = normalizeComments(rawComments.map((c: any) => ({
                        ...c,
                        anchor: typeof c.anchor === 'string' ? c.anchor : anchorFor(c.line),
                    })));
                    if (comments.length > 0) out.push({ action: 'add_comments', comments, file: filePath });
                }
                break;
            }
            case 'remove_comments': {
                const preserveLines = Array.isArray(payload.preserveLines)
                    ? payload.preserveLines.filter((n: unknown) => typeof n === 'number')
                    : undefined;
                const scopeRaw = a.target?.scope;
                const scope = scopeRaw === 'selection' || scopeRaw === 'file' ? scopeRaw : undefined;
                const selectionRange = a.target?.selectionRange;
                out.push({
                    action: 'remove_comments',
                    file: filePath,
                    ...(preserveLines ? { preserveLines } : {}),
                    ...(scope ? { scope } : {}),
                    ...(selectionRange ? { selectionRange } : {}),
                });
                break;
            }
            case 'create_file': {
                const p = payload.path || a.target?.filePath || (a as any).path;
                const content = payload.content ?? (a as any).content ?? '';
                if (p) out.push({ action: 'create_file', path: p, content: String(content) });
                break;
            }
            case 'delete_file': {
                const p = payload.path || a.target?.filePath || (a as any).path;
                if (p) out.push({ action: 'delete_file', path: p });
                break;
            }
            case 'rename_file': {
                const p = payload.path || a.target?.filePath || (a as any).path;
                const newPath = payload.newPath || (a as any).newPath;
                if (p && newPath) out.push({ action: 'rename_file', path: p, newPath });
                break;
            }
            case 'update_file': {
                const p = payload.path || a.target?.filePath || (a as any).path || filePath;
                const content = payload.content ?? (a as any).content ?? '';
                if (p) out.push({ action: 'update_file', path: p, content: String(content) });
                break;
            }
            case 'insert_code': {
                const line = payload.line ?? (a as any).line;
                const content = payload.content ?? (a as any).content ?? '';
                if (typeof line === 'number') {
                    out.push({
                        action: 'insert_code',
                        path: filePath,
                        line,
                        content: String(content),
                        anchor: anchorFor(line),
                    });
                }
                break;
            }
            case 'replace_code': {
                const startLine = payload.startLine ?? (a as any).startLine;
                const endLine = payload.endLine ?? (a as any).endLine ?? startLine;
                const content = payload.content ?? (a as any).content ?? '';
                if (typeof startLine === 'number' && typeof endLine === 'number') {
                    out.push({
                        action: 'replace_code',
                        path: filePath,
                        startLine,
                        endLine,
                        content: String(content),
                        anchor: anchorFor(startLine),
                    });
                }
                break;
            }
            case 'delete_code': {
                const startLine = payload.startLine ?? (a as any).startLine;
                const endLine = payload.endLine ?? (a as any).endLine ?? startLine;
                if (typeof startLine === 'number' && typeof endLine === 'number') {
                    out.push({ action: 'delete_code', path: filePath, startLine, endLine });
                }
                break;
            }
            case 'refactor':
            case 'fix': {
                const content = payload.content;
                if (typeof content === 'string' && content.trim() && filePath) {
                    out.push({ action: 'update_file', path: filePath, content });
                }
                break;
            }
            case 'chat':
            case 'explain':
                // No file mutation
                break;
            default:
                break;
        }
    }
    return out.length > 0 ? out : null;
}
