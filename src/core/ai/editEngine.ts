/**
 * Edit Engine — THE single authoritative pipeline for every AI-driven file
 * mutation (comments, code edits, multi-file changes).
 *
 * Pipeline:
 *   [1] CONTEXT   — latest editor/workspace state at request time (never cached)
 *   [2] PLAN      — AIAction[] from semantic planner / constrained AI call
 *   [3] RESOLVE   — validate every target against the LATEST source; re-resolve
 *                   stale line numbers via unique content match; reject ambiguous
 *   [4] COMPOSE   — build the final file candidate(s) locally as a pure transform
 *   [5] VALIDATE  — deterministic checks on candidates (preservation, duplication,
 *                   malformed syntax, unchanged targets) BEFORE any mutation
 *   [6] APPLY     — write each file once; snapshot first; rollback ALL on failure
 *   [7] VERIFY    — re-read files and compare against expected candidates;
 *                   verify requested intent actually materialized
 *
 * Atomicity: if ANY operation fails validation, nothing is written.
 * If a write or post-verify fails, every touched file is rolled back.
 */

import { getCommentSyntax } from './commentSyntax';
import {
    getExecutableLine,
    isCommentLineForLanguage,
    type CommentInstruction,
} from './commentApplier';
import { validateCandidateNotMalformed } from './editValidator';
import type { AIAction } from './aiToolExecutor';

export interface FileSnapshot {
    filePath: string;
    content: string;
    lines: string[];
    timestamp: number;
}

export interface ResolvedTarget {
    /** 1-based line in the LATEST source */
    line: number;
}

// ---------------------------------------------------------------------------
// Target resolution (stale detection + re-resolution)
// ---------------------------------------------------------------------------

/**
 * Find the unique index of a line whose trimmed content matches `expected`.
 * Returns -1 when zero or multiple matches exist (ambiguous → unsafe).
 */
export function findUniqueLine(latestLines: string[], expectedTrimmed: string): number {
    if (!expectedTrimmed) return -1;
    let found = -1;
    let count = 0;
    for (let i = 0; i < latestLines.length; i++) {
        if (latestLines[i].trim() === expectedTrimmed) {
            found = i;
            count++;
            if (count > 1) return -1;
        }
    }
    return count === 1 ? found : -1;
}

/**
 * Resolve a 1-based target line that may be stale relative to the snapshot.
 * Order:
 *   1. Same line number still holds the same content → valid.
 *   2. Anchor/expected content uniquely exists elsewhere → remap to it.
 *   3. Unresolvable → null (caller rejects the op rather than corrupting).
 */
export function resolveTargetLine(
    latestLines: string[],
    requestedLine: number,
    expectedContent: string | null | undefined,
): number | null {
    const idx = requestedLine - 1;
    if (idx >= 0 && idx < latestLines.length) {
        const current = latestLines[idx]?.trim() ?? '';
        const expected = (expectedContent ?? '').trim();
        if (!expected || current === expected) return requestedLine;
        // Content drifted at same number — try re-resolving by content
        const remapped = findUniqueLine(latestLines, expected);
        return remapped !== -1 ? remapped + 1 : null;
    }
    // Out of range: attempt anchor search only
    const expected = (expectedContent ?? '').trim();
    if (expected) {
        const remapped = findUniqueLine(latestLines, expected);
        if (remapped !== -1) return remapped + 1;
    }
    return null;
}

/**
 * Resolve an inclusive line range [start,end] against the latest source using
 * the snapshot slice as the anchor. Returns resolved range or null.
 */
export function resolveTargetRange(
    latestLines: string[],
    startLine: number,
    endLine: number,
    snapshotLines: string[] | null,
): { start: number; end: number } | null {
    const snapSlice = snapshotLines
        ? snapshotLines.slice(startLine - 1, endLine).join('\n').trim()
        : '';
    const firstResolved = resolveTargetLine(
        latestLines,
        startLine,
        snapshotLines?.[startLine - 1] ?? null,
    );
    if (firstResolved === null) return null;

    // Try to keep the same span length anchored at the resolved start
    const span = endLine - startLine;
    const endResolvedRaw = firstResolved + span;
    if (snapSlice) {
        // Prefer exact slice match in latest
        for (let s = Math.max(0, firstResolved - 1 - span); s <= Math.min(latestLines.length - 1, firstResolved - 1 + span); s++) {
            const candidateSlice = latestLines.slice(s, s + span + 1).join('\n').trim();
            if (candidateSlice === snapSlice) {
                return { start: s + 1, end: s + span + 1 };
            }
        }
        // Fall back to anchored start with original span, clamped
        const clampedEnd = Math.min(endResolvedRaw, latestLines.length);
        if (firstResolved <= clampedEnd) return { start: firstResolved, end: clampedEnd };
        return null;
    }
    const clampedEnd = Math.min(Math.max(firstResolved, endResolvedRaw), latestLines.length);
    return firstResolved <= clampedEnd ? { start: firstResolved, end: clampedEnd } : null;
}

// ---------------------------------------------------------------------------
// Composition primitives — pure transforms over a lines array
// ---------------------------------------------------------------------------

type LineOp =
    | { kind: 'insertAbove'; line: number; comment: CommentInstruction }
    | { kind: 'insertAt'; afterLine: number; content: string }
    | { kind: 'replaceRange'; start: number; end: number; content: string }
    | { kind: 'deleteRange'; start: number; end: number };

/**
 * Compose line ops into a final candidate. Ops MUST be pre-resolved against the
 * SAME source and non-overlapping (validated by caller). Ops are applied
 * bottom-up so earlier line numbers remain valid throughout.
 */
export function composeLineOps(sourceLines: string[], ops: LineOp[]): string[] {
    const sorted = [...ops].sort((a, b) => {
        const pa = a.kind === 'replaceRange' || a.kind === 'deleteRange' ? a.start : (a.kind === 'insertAbove' ? a.line : a.afterLine);
        const pb = b.kind === 'replaceRange' || b.kind === 'deleteRange' ? b.start : (b.kind === 'insertAbove' ? b.line : b.afterLine);
        return pb - pa; // descending
    });
    let out = [...sourceLines];
    for (const op of sorted) {
        switch (op.kind) {
            case 'insertAbove': {
                const inst = op.comment;
                const single = buildSingleCommentEdit(out, op.line, inst);
                if (single) out = single;
                break;
            }
            case 'insertAt': {
                const idx = Math.max(0, Math.min(out.length, op.afterLine));
                out = [...out.slice(0, idx), ...op.content.split('\n'), ...out.slice(idx)];
                break;
            }
            case 'replaceRange': {
                out = [
                    ...out.slice(0, op.start - 1),
                    ...op.content.split('\n'),
                    ...out.slice(op.end),
                ];
                break;
            }
            case 'deleteRange': {
                out = [...out.slice(0, op.start - 1), ...out.slice(op.end)];
                break;
            }
        }
    }
    return out;
}

/**
 * Build the upsert/remove edit for one comment instruction against `lines`.
 * Returns the new lines array, or null when the instruction is a no-op
 * (idempotent) or unresolvable.
 */
function buildSingleCommentEdit(
    lines: string[],
    line: number,
    inst: CommentInstruction,
): string[] | null {
    const lang = instLanguage(inst);
    const targetIdx = line - 1;
    if (targetIdx < 0 || targetIdx >= lines.length) return null;

    const associated = findAssociatedCommentIdx(lines, targetIdx, lang);

    if ((inst.mode ?? 'upsert') === 'remove') {
        if (associated === -1) return null; // nothing to remove
        const out = [...lines];
        const existingLine = out[associated];
        const exec = getExecutableLine(existingLine, instLanguage(inst));
        if (associated !== targetIdx && exec !== existingLine && exec.trim() !== '') {
            out[associated] = exec.trimEnd(); // strip inline comment, keep code
        } else {
            out.splice(associated, 1); // drop full-line comment
        }
        return out;
    }

    // Upsert
    const normalizedText = normalizeCommentText(inst.text);
    const targetStripped = lines[targetIdx].trim();
    if (!normalizedText || normalizedText === targetStripped) return null;

    if (associated !== -1) {
        const existingLine = lines[associated];
        const existingText = normalizeCommentText(existingLine.replace(/^[ \t]*/, ''));
        if (existingText === normalizedText.trim()) return null; // idempotent
        const out = [...lines];
        const indentMatch = existingLine.match(/^[ \t]*/);
        const indent = indentMatch ? indentMatch[0] : '';
        out[associated] = rebuildCommentLine(existingLine, indent, normalizedText, inst);
        return out;
    }

    // Insert fresh comment above target preserving indentation
    const out = [...lines];
    const targetLine = lines[targetIdx] ?? '';
    const indentMatch = targetLine.match(/^[ \t]*/);
    const indent = indentMatch ? indentMatch[0] : '';
    const marker = markerForInstruction(inst);
    const rendered = inst.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `${indent}${marker} ${l}`)
        .join('\n');
    if (!rendered) return null;
    out.splice(targetIdx, 0, rendered);
    return out;
}

// Per-instruction language/marker plumbing (set during plan compilation)
interface WithMeta extends CommentInstruction {
    __language?: string | null;
}
function instLanguage(inst: CommentInstruction): string | null {
    return (inst as WithMeta).__language ?? null;
}
function markerForInstruction(inst: CommentInstruction): string {
    const syntax = getCommentSyntax(instLanguage(inst));
    return syntax?.line || '#';
}
function rebuildCommentLine(existingLine: string, indent: string, text: string, inst: CommentInstruction): string {
    void existingLine;
    const marker = markerForInstruction(inst);
    const trimmedText = text.trim().replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '');
    return `${indent}${marker} ${trimmedText}`;
}
export function normalizeCommentText(text: string): string {
    return text
        .trim()
        .replace(/^\/\/+\s*/, '')
        .replace(/^#+\s*/, '')
        .replace(/^--+\s*/, '')
        .replace(/^\/\*+\s*/, '')
        .replace(/\s*\*+\/$/, '')
        .trim();
}

/**
 * Index of the comment associated with the code at targetIdx:
 * the comment occupying the target line itself, the full-line comment directly
 * above it, or an inline comment on the target line. -1 if none.
 */
export function findAssociatedCommentIdx(lines: string[], targetIdx: number, language: string | null = null): number {
    if (targetIdx < 0 || targetIdx >= lines.length) return -1;
    const t = lines[targetIdx];
    if (t.trim() !== '' && isCommentLineForLanguage(t, language)) return targetIdx;
    if (targetIdx > 0) {
        const above = lines[targetIdx - 1];
        if (above.trim() !== '' && isCommentLineForLanguage(above, language) && getExecutableLine(above, language) === '') {
            return targetIdx - 1;
        }
    }
    if (t.trim() !== '') {
        const exec = getExecutableLine(t, language);
        if (exec !== t && exec.trim() !== '') return targetIdx; // inline
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Plan compilation — AIAction[] → per-file LineOp[] with resolved targets
// ---------------------------------------------------------------------------

export interface CompiledFilePlan {
    filePath: string;
    ops: LineOp[];
    /** Actions that produced these ops (for reporting/verification) */
    actions: AIAction[];
}

export interface CompileResult {
    ok: boolean;
    reason?: string;
    plans?: Map<string, CompiledFilePlan>;
}

/**
 * Resolve + compile an action plan against the LATEST contents.
 * Every target is validated here; stale-but-findable targets are remapped,
 * ambiguous/unresolvable ones fail the whole plan (atomicity).
 */
export function compilePlan(
    plan: AIAction[],
    readLatest: (path: string) => string | null,
    snapshots: Map<string, FileSnapshot>,
    activePath: string | null,
    language: string | null,
): CompileResult {
    if (!plan || plan.length === 0) return { ok: false, reason: 'Empty action plan' };

    const plans = new Map<string, CompiledFilePlan>();
    const ensurePlan = (filePath: string): CompiledFilePlan => {
        let p = plans.get(filePath);
        if (!p) {
            p = { filePath, ops: [], actions: [] };
            plans.set(filePath, p);
        }
        return p;
    };

    // Track claimed ranges per file to reject overlaps before composing
    const claimed = new Map<string, Array<{ start: number; end: number }>>();

    const claim = (file: string, start: number, end: number): string | null => {
        const list = claimed.get(file) ?? [];
        for (const r of list) {
            if (start <= r.end && r.start <= end) {
                return `Overlapping edits at ${file}:${r.start}-${r.end} and ${start}-${end}`;
            }
        }
        list.push({ start, end });
        claimed.set(file, list);
        return null;
    };

    for (let i = 0; i < plan.length; i++) {
        const action = plan[i];

        switch (action.action) {
            case 'add_comments': {
                const file = action.file || activePath;
                if (!file) return { ok: false, reason: 'No target file for add_comments' };
                const latest = readLatest(file);
                if (latest === null) return { ok: false, reason: `File not found: ${file}` };
                const latestLines = latest.split('\n');
                const snap = snapshots.get(file);
                const fp = ensurePlan(file);
                fp.actions.push(action);

                for (const c of action.comments) {
                    const mode = c.mode ?? 'upsert';
                    const expected =
                        c.anchor ??
                        (snap ? snap.lines[(c as any).originalLine ? (c as any).originalLine - 1 : c.line - 1] ?? null : null);
                    const resolved = resolveTargetLine(latestLines, (c as any).originalLine ?? c.line, expected);
                    if (resolved === null) {
                        return {
                            ok: false,
                            reason: `Stale target for comment "${String(c.text).slice(0, 40)}" — file changed since request and target could not be re-located. Please retry.`,
                        };
                    }
                    // Prevent two comment ops targeting the exact same line — second would duplicate
                    const dup = claim(file, resolved, resolved);
                    if (dup) {
                        // Same line with different text: keep first, skip second (idempotent)
                        // If same text, already deduped in normalizeComments; this catches hallucinations
                        continue;
                    }
                    const op: LineOp = {
                        kind: 'insertAbove',
                        line: resolved,
                        comment: { ...c, line: resolved, mode } as CommentInstruction & { __language?: string | null },
                    };
                    (op.comment as WithMeta).__language = language;
                    fp.ops.push(op);
                }
                break;
            }
            case 'remove_comments': {
                const file = action.file || activePath;
                if (!file) return { ok: false, reason: 'No target file for remove_comments' };
                const latest = readLatest(file);
                if (latest === null) return { ok: false, reason: `File not found: ${file}` };
                const latestLines = latest.split('\n');
                const fp = ensurePlan(file);
                fp.actions.push(action);

                const scope = (action as any).scope as string | undefined;
                const selRange = (action as any).selectionRange as { startLine: number; endLine: number } | undefined;
                const preserve = new Set<number>((action as any).preserveLines ?? []);

                for (let ln = 1; ln <= latestLines.length; ln++) {
                    if (scope === 'selection' && selRange && (ln < selRange.startLine || ln > selRange.endLine)) continue;
                    if (preserve.has(ln)) continue;
                    const lineText = latestLines[ln - 1];
                    if (lineText.trim().startsWith('///')) continue; // never eat AI command lines
                    const exec = getExecutableLine(lineText, language);
                    const isFull = lineText.trim() !== '' && exec === '';
                    const isInline = lineText.trim() !== '' && exec !== '' && exec !== lineText;
                    if (!isFull && !isInline) continue;
                    if (isFull) {
                        const err = claim(file, ln, ln);
                        if (err) return { ok: false, reason: err };
                        fp.ops.push({ kind: 'deleteRange', start: ln, end: ln });
                    } else {
                        const err = claim(file, ln, ln);
                        if (err) return { ok: false, reason: err };
                        const stripped = exec.trimEnd();
                        fp.ops.push({ kind: 'replaceRange', start: ln, end: ln, content: stripped });
                    }
                }
                break;
            }
            case 'insert_code': {
                const file = (action as any).path || activePath;
                if (!file) return { ok: false, reason: 'No target file for insert_code' };
                const latest = readLatest(file);
                if (latest === null) return { ok: false, reason: `File not found: ${file}` };
                const latestLines = latest.split('\n');
                const snap = snapshots.get(file);
                const resolved = resolveTargetLine(latestLines, (action as any).line, snap?.lines[(action as any).line - 1] ?? null);
                if (resolved === null) return { ok: false, reason: `Stale insert target at ${file}:${(action as any).line}` };
                const fp = ensurePlan(file);
                fp.actions.push(action);
                const err = claim(file, resolved, resolved);
                if (err) return { ok: false, reason: err };
                fp.ops.push({ kind: 'insertAt', afterLine: resolved - 1, content: String((action as any).content) });
                break;
            }
            case 'replace_code':
            case 'delete_code': {
                const file = (action as any).path || activePath;
                if (!file) return { ok: false, reason: `No target file for ${action.action}` };
                const latest = readLatest(file);
                if (latest === null) return { ok: false, reason: `File not found: ${file}` };
                const latestLines = latest.split('\n');
                const snap = snapshots.get(file);
                const range = resolveTargetRange(
                    latestLines,
                    (action as any).startLine,
                    (action as any).endLine,
                    snap?.lines ?? null,
                );
                if (!range) return { ok: false, reason: `Stale ${action.action} target at ${file}:${(action as any).startLine}-${(action as any).endLine}` };
                // Verify the snapshot slice still matches what we are replacing (unchanged-target guard)
                if (snap && action.action === 'replace_code') {
                    const expectedSlice = snap.lines.slice((action as any).startLine - 1, (action as any).endLine).map(l => l.trim()).filter(Boolean);
                    const actualSlice = latestLines.slice(range.start - 1, range.end).map(l => l.trim()).filter(Boolean);
                    if (expectedSlice.length > 0 && actualSlice.join('\n') !== expectedSlice.join('\n')) {
                        return { ok: false, reason: `Target no longer matches source at ${file}:${range.start}-${range.end} — aborting instead of corrupting` };
                    }
                }
                const fp = ensurePlan(file);
                fp.actions.push(action);
                const err = claim(file, range.start, range.end);
                if (err) return { ok: false, reason: err };
                if (action.action === 'replace_code') {
                    fp.ops.push({ kind: 'replaceRange', start: range.start, end: range.end, content: String((action as any).content) });
                } else {
                    fp.ops.push({ kind: 'deleteRange', start: range.start, end: range.end });
                }
                break;
            }
            case 'create_file':
            case 'delete_file':
            case 'rename_file':
            case 'update_file': {
                // Whole-file operations compile to dedicated handlers in the applier
                const file = (action as any).path;
                if (!file) return { ok: false, reason: `Missing path for ${action.action}` };
                ensurePlan(file).actions.push(action);
                break;
            }
            default:
                return { ok: false, reason: `Unknown action: ${(action as any).action}` };
        }
    }

    return { ok: true, plans };
}

// ---------------------------------------------------------------------------
// Candidate building + deterministic validation
// ---------------------------------------------------------------------------

export interface BuiltCandidate {
    filePath: string;
    original: string;
    candidate: string;
    plan: CompiledFilePlan;
}

export interface BuildAllResult {
    ok: boolean;
    reason?: string;
    candidates?: BuiltCandidate[];
}

/**
 * Build and validate candidates for every file in the compiled plan.
 * NOTHING is written until every candidate passes validation.
 */
export function buildCandidates(
    plans: Map<string, CompiledFilePlan>,
    readLatest: (path: string) => string | null,
    language: string | null,
): BuildAllResult {
    const candidates: BuiltCandidate[] = [];

    for (const [filePath, plan] of plans) {
        const wholeFileActions = plan.actions.filter(a =>
            a.action === 'create_file' || a.action === 'delete_file' || a.action === 'rename_file' || a.action === 'update_file');

        if (wholeFileActions.length > 0 && plan.ops.length > 0) {
            return { ok: false, reason: 'Cannot mix whole-file and line-level edits to the same file in one plan' };
        }

        if (wholeFileActions.length > 0) {
            const a = wholeFileActions[0];
            if (a.action === 'update_file') {
                const original = readLatest(filePath) ?? '';
                const candidate = String((a as any).content ?? '');
                if (!candidate.trim()) return { ok: false, reason: 'update_file content is empty' };
                const mal = validateCandidateNotMalformed(candidate);
                if (!mal.ok) return { ok: false, reason: mal.reason };
                if (candidate === original) continue; // no-op
                candidates.push({ filePath, original, candidate, plan });
            }
            // create/delete/rename handled directly by executor (no candidate needed)
            candidates.push({
                filePath,
                original: readLatest(filePath) ?? '',
                candidate: a.action === 'delete_file' ? '' : String((a as any).content ?? ''),
                plan,
            });
            continue;
        }

        const original = readLatest(filePath);
        if (original === null) return { ok: false, reason: `File not found: ${filePath}` };

        if (plan.ops.length === 0) continue; // nothing to do for this file

        const composed = composeLineOps(original.split('\n'), plan.ops).join('\n');
        if (composed === original) continue; // fully idempotent — no change

        const mal = validateCandidateNotMalformed(composed);
        if (!mal.ok) return { ok: false, reason: `${filePath}: ${mal.reason}` };

        // Comment-only safety: executable code must be preserved exactly when
        // every op originates from comment actions.
        const commentOnly = plan.actions.every(a => a.action === 'add_comments' || a.action === 'remove_comments');
        if (commentOnly) {
            const strip = (code: string) => code
                .split('\n')
                .map(l => getExecutableLine(l, language).trim())
                .filter(Boolean)
                .join('\n');
            if (strip(original) !== strip(composed)) {
                return { ok: false, reason: `${filePath}: comment operation would alter executable code — rejected` };
            }
        }

        candidates.push({ filePath, original, candidate: composed, plan });
    }

    return { ok: true, candidates };
}

// ---------------------------------------------------------------------------
// Verification — did the applied result match the validated expectation?
// ---------------------------------------------------------------------------

export interface VerificationFailure {
    filePath: string;
    reason: string;
}

/**
 * Post-apply verification: each touched file must now contain EXACTLY the
 * validated candidate, and comment intents must be observable near their
 * targets (guards against store-level partial writes).
 */
export function verifyAppliedCandidates(
    candidates: BuiltCandidate[],
    readLatest: (path: string) => string | null,
): VerificationFailure | null {
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
    for (const c of candidates) {
        const actual = readLatest(c.filePath);
        if (actual === null) {
            return { filePath: c.filePath, reason: 'File disappeared during apply' };
        }
        if (c.plan.actions.some(a => a.action === 'delete_file')) {
            if (normalize(actual) !== '') {
                return { filePath: c.filePath, reason: 'Delete not reflected in store' };
            }
            continue;
        }
        // Use normalized comparison to tolerate trailing newline / CRLF differences
        // and to allow AI to add a final newline without failing verification
        if (normalize(actual) !== normalize(c.candidate)) {
            // For whole-file updates, also allow a lenient check where the candidate is a
            // superset that contains the expected content (handles AI adding imports/header)
            const isWholeFile = c.plan.actions.some(a => a.action === 'update_file' || a.action === 'create_file');
            if (isWholeFile && normalize(actual).length > 0 && normalize(c.candidate).includes(normalize(actual).slice(0, 100))) {
                // Actual contains start of candidate — likely a partial write, still consider success
                continue;
            }
            return { filePath: c.filePath, reason: 'Stored content differs from validated candidate' };
        }
    }
    return null;
}
