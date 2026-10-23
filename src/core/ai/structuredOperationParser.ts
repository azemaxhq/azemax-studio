/**
 * Structured Operation Parser — deterministic, no hardcoding of phrases.
 *
 * Parses AI JSON into safe edit operations. Supports the new canonical format:
 *   {"operations":[{"type":"add_comment","line":4,"text":"Prints the greeting"}]}
 * and legacy formats:
 *   {"action":"add_comments","comments":[{line,text}]}
 *   {"operations":[{"type":"remove_comments",...}]}
 *   {"actions":[...]}
 *
 * Never regenerates entire file when small change suffices — parser prefers
 * exact line/range ops and only allows full-file `update_file` when genuinely necessary.
 */

import type { AIAction } from './actionTypes';
import { normalizeCommentMode } from './commentApplier';

type RawOp = Record<string, unknown>;

function normalizeCommentLine(raw: RawOp): { line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string } | null {
    const line = (raw.line ?? raw.startLine ?? (raw as any).lineNumber) as unknown;
    const text = (raw.text ?? raw.comment ?? raw.content ?? (raw as any).replacement) as unknown;
    if (typeof line !== 'number' || typeof text !== 'string') return null;
    const cleaned = text.trim().replace(/^\/\/+\s*/, '').replace(/^#+\s*/, '').replace(/;\s*$/, '').trim();
    const mode = normalizeCommentMode(raw.mode ?? raw.op);
    const anchorRaw = typeof raw.anchor === 'string' ? raw.anchor : null;
    const anchor = anchorRaw !== null ? anchorRaw.trim() : null;
    if (!cleaned && mode !== 'remove') return null;
    const out: { line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string } = {
        line: Math.max(1, Math.floor(line)),
        text: cleaned,
    };
    if (mode !== 'upsert') out.mode = mode;
    if (anchor) out.anchor = anchor;
    return out;
}

function normalizeType(rawType: unknown): string {
    if (typeof rawType !== 'string') return '';
    return rawType.trim().toLowerCase().replace(/-/g, '_');
}

function parseOperationsArray(arr: unknown[], fallbackFile?: string): AIAction[] | null {
    const out: AIAction[] = [];
    for (const item of arr) {
        if (typeof item !== 'object' || item === null) continue;
        const op = item as RawOp;
        const type = normalizeType(op.type ?? op.action ?? (op as any).operation);

        // Comment ops — singular/plural. add/update/change/replace converge on
        // upsert semantics; remove/delete strip the comment (handled below).
        if (type === 'add_comment' || type === 'add_comments' || type === 'addcomment' || type === 'comment' || type === 'change_comment' || type === 'update_comment' || type === 'replace_comment' || type === 'edit_comment' || type === 'modify_comment') {
            // Single line comment
            if (typeof op.line === 'number' && typeof (op.text ?? op.comment ?? op.content) === 'string') {
                const n = normalizeCommentLine(op);
                if (n) out.push({ action: 'add_comments', comments: [n], file: (op.file as string) || (op.path as string) || fallbackFile });
                continue;
            }
            // Batch
            const rawComments = (op.comments ?? op.operations ?? []) as unknown;
            if (Array.isArray(rawComments)) {
                const comments: Array<{ line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string }> = [];
                for (const c of rawComments as RawOp[]) {
                    const n = normalizeCommentLine(c as RawOp);
                    if (n) comments.push(n);
                }
                if (comments.length > 0) out.push({ action: 'add_comments', comments, file: (op.file as string) || fallbackFile });
                continue;
            }
            // Also handle payload.comments
            const payload = (op.payload as RawOp) || {};
            if (Array.isArray(payload.comments)) {
                const comments: Array<{ line: number; text: string; mode?: 'upsert' | 'remove'; anchor?: string }> = [];
                for (const c of payload.comments as RawOp[]) {
                    const n = normalizeCommentLine(c as RawOp);
                    if (n) comments.push(n);
                }
                if (comments.length > 0) out.push({ action: 'add_comments', comments, file: (op.file as string) || fallbackFile });
            }
            continue;
        }

        if (type === 'remove_comment' || type === 'remove_comments' || type === 'removecomment' || type === 'delete_comment' || type === 'remove_this_comment') {
            const preserveLines = Array.isArray(op.preserveLines) ? (op.preserveLines as number[]).filter(n => typeof n === 'number')
                : Array.isArray((op.payload as RawOp)?.preserveLines) ? ((op.payload as RawOp).preserveLines as number[]).filter(n => typeof n === 'number')
                : undefined;
            const removeLines = Array.isArray(op.removeLines) ? (op.removeLines as number[]).filter(n => typeof n === 'number')
                : Array.isArray((op.payload as RawOp)?.removeLines) ? ((op.payload as RawOp).removeLines as number[]).filter(n => typeof n === 'number')
                : undefined;
            const file = (op.file as string) || (op.path as string) || (op as any).target?.filePath || fallbackFile;
            const scope = (op as any).scope || (op as any).target?.scope;
            const selectionRange = (op as any).selectionRange || (op as any).target?.selectionRange;

            // Specific comment lines to remove → deterministic per-line removal ops.
            // The executor resolves each line against the latest source and strips
            // only the comment, preserving executable code.
            if (removeLines && removeLines.length > 0 && !preserveLines && !selectionRange && scope !== 'file') {
                const comments = removeLines.map(l => ({ line: Math.max(1, Math.floor(l)), text: '', mode: 'remove' as const }));
                out.push({ action: 'add_comments', comments, file });
                continue;
            }
            out.push({
                action: 'remove_comments',
                file,
                ...(preserveLines ? { preserveLines } : {}),
                ...(scope ? { scope: scope as any } : {}),
                ...(selectionRange ? { selectionRange } : {}),
            });
            continue;
        }

        // Line ops
        if (type === 'insert' || type === 'insert_code' || type === 'add_line') {
            const line = (op.line ?? (op as any).startLine ?? (op.payload as RawOp)?.line) as unknown;
            const content = (op.content ?? op.text ?? (op.payload as RawOp)?.content) as unknown;
            if (typeof line === 'number' && typeof content === 'string') {
                out.push({ action: 'insert_code', path: (op.path as string) || (op.file as string) || fallbackFile, line: Math.max(1, Math.floor(line)), content });
            }
            continue;
        }
        if (type === 'delete' || type === 'delete_code' || type === 'remove_line' || type === 'delete_line') {
            const startLine = (op.line ?? op.startLine ?? (op as any).start) as unknown;
            const endLine = (op.endLine ?? (op as any).end ?? startLine) as unknown;
            const file = (op.path as string) || (op.file as string) || fallbackFile;
            if (typeof startLine === 'number') {
                const s = Math.max(1, Math.floor(startLine));
                const e = typeof endLine === 'number' ? Math.max(s, Math.floor(endLine)) : s;
                out.push({ action: 'delete_code', path: file, startLine: s, endLine: e });
            }
            continue;
        }
        if (type === 'replace' || type === 'replace_code' || type === 'update_line' || type === 'change_line') {
            const startLine = (op.startLine ?? op.line ?? (op as any).start) as unknown;
            const endLine = (op.endLine ?? op.line ?? (op as any).end) as unknown;
            const content = (op.content ?? op.text ?? op.replacement ?? (op.payload as RawOp)?.content) as unknown;
            const file = (op.path as string) || (op.file as string) || fallbackFile;
            if (typeof startLine === 'number' && typeof content === 'string') {
                const s = Math.max(1, Math.floor(startLine));
                const e = typeof endLine === 'number' ? Math.max(s, Math.floor(endLine)) : s;
                out.push({ action: 'replace_code', path: file, startLine: s, endLine: e, content });
            }
            continue;
        }

        // File ops
        if (type === 'create_file' || type === 'create' || type === 'new_file') {
            const path = (op.path ?? op.file ?? (op as any).filePath) as unknown;
            const content = (op.content ?? (op as any).text ?? '') as unknown;
            if (typeof path === 'string') out.push({ action: 'create_file', path, content: typeof content === 'string' ? content : '' });
            continue;
        }
        if (type === 'delete_file' || type === 'remove_file') {
            const path = (op.path ?? op.file ?? (op as any).filePath) as unknown;
            if (typeof path === 'string') out.push({ action: 'delete_file', path });
            continue;
        }
        if (type === 'rename_file' || type === 'rename' || type === 'move_file') {
            const path = (op.path ?? op.file ?? (op as any).filePath) as unknown;
            const newPath = (op.newPath ?? (op as any).new_path ?? (op as any).to) as unknown;
            if (typeof path === 'string' && typeof newPath === 'string') out.push({ action: 'rename_file', path, newPath });
            continue;
        }
        if (type === 'update_file' || type === 'modify_file' || type === 'replace_file') {
            const path = (op.path ?? op.file ?? (op as any).filePath ?? fallbackFile) as unknown;
            const content = (op.content ?? (op as any).text ?? '') as unknown;
            if (typeof path === 'string' && typeof content === 'string') out.push({ action: 'update_file', path, content });
            continue;
        }

        // High-level intents that should have been expanded — if payload has content, treat as update
        if (type === 'refactor' || type === 'fix' || type === 'format' || type === 'rename_variable' || type === 'rename_function') {
            const payload = (op.payload as RawOp) || op;
            const content = (payload.content ?? payload.text) as unknown;
            const file = (op.path as string) || (op.file as string) || fallbackFile;
            if (typeof content === 'string' && content.trim() && typeof file === 'string') {
                // Prefer range ops if line info present, else full file
                const s = (payload.startLine ?? op.startLine) as unknown;
                const e = (payload.endLine ?? op.endLine) as unknown;
                if (typeof s === 'number' && typeof e === 'number' && typeof content === 'string') {
                    out.push({ action: 'replace_code', path: file, startLine: Math.max(1, Math.floor(s)), endLine: Math.max(1, Math.floor(e)), content });
                } else {
                    out.push({ action: 'update_file', path: file, content });
                }
            }
            continue;
        }
    }
    return out.length > 0 ? out : null;
}

export function parseStructuredOperations(raw: string, fallbackFile?: string): AIAction[] | null {
    if (!raw || typeof raw !== 'string') return null;
    let candidate = raw.trim();
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();
    const match = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) return parseOperationsArray(parsed, fallbackFile);
        if (parsed && typeof parsed === 'object') {
            if (Array.isArray((parsed as RawOp).operations)) return parseOperationsArray((parsed as RawOp).operations as unknown[], fallbackFile);
            if (Array.isArray((parsed as RawOp).actions)) return parseOperationsArray((parsed as RawOp).actions as unknown[], fallbackFile);
            // Single operation object
            if ((parsed as RawOp).type || (parsed as RawOp).action) {
                return parseOperationsArray([parsed as RawOp], fallbackFile);
            }
            // Legacy add_comments shorthand
            if (Array.isArray((parsed as RawOp).comments)) {
                const comments: Array<{ line: number; text: string }> = [];
                for (const c of (parsed as RawOp).comments as unknown as RawOp[]) {
                    const n = normalizeCommentLine(c);
                    if (n) comments.push(n);
                }
                if (comments.length > 0) return [{ action: 'add_comments', comments, file: (parsed as RawOp).file as string || fallbackFile }];
            }
        }
        return null;
    } catch {
        return null;
    }
}
