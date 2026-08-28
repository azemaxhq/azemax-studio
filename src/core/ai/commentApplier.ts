/**
 * Deterministic comment insertion for the COMMENT operation.
 *
 * The AI returns ONLY comment metadata (line -> text), never source code.
 * This module inserts those comments into the current Monaco model,
 * preserving executable code exactly and ensuring idempotence.
 */

import { getCommentSyntax } from './commentSyntax';
import { stripCommentMarkers, getIndent, buildCommentLine, buildReplacementComment } from './commentApplier.helpers';

/**
 * A single comment instruction produced by intent resolution.
 *
 * `mode` lets the AI decide the operation explicitly:
 *  - 'upsert' (default): insert the comment; if an associated comment already
 *    exists (same line, directly above, or inline) its text is replaced instead
 *    of stacking a duplicate. 'add'/'replace' are accepted aliases.
 *  - 'remove': delete the associated comment (full-line removal, or inline part
 *    stripped) while preserving executable code.
 *
 * `anchor` optionally carries the exact snapshot content of the target line so
 * the executor can validate the target against the LATEST source before applying.
 */
export type CommentMode = 'upsert' | 'remove';

export interface CommentInstruction {
    line: number; // 1-based source line to comment above
    text: string; // raw comment text, without markers
    mode?: CommentMode;
    anchor?: string | null; // expected target-line content at plan time
}

export function normalizeCommentMode(raw: unknown): CommentMode {
    if (typeof raw !== 'string') return 'upsert';
    const t = raw.trim().toLowerCase();
    if (t === 'remove' || t === 'delete' || t === 'strip') return 'remove';
    return 'upsert'; // add / replace / change / update all converge on upsert
}

export interface CommentJson {
    comments: CommentInstruction[];
    operation?: string;
}

/**
 * Parse AI response for comment metadata.
 * Supports:
 * - {"comments": [{"line":1,"text":"..."}]}
 * - {"comments": [{"line":1,"comment":"..."}]}
 * - {"operation":"comment","comments":[...]}
 * - {"comments":[{"line":1,"text":"...","mode":"remove"}]}
 * - fenced JSON ```json ... ```
 * - legacy structured edits fallback (handled by caller)
 */
function extractInstruction(item: unknown): CommentInstruction | null {
    if (typeof item !== 'object' || item === null) return null;
    const r = item as Record<string, unknown>;
    const line = (r.line ?? r.startLine ?? r.lineNumber) as unknown;
    const rawText = (r.text ?? r.comment ?? r.content ?? r.replacement) as unknown;
    if (typeof line !== 'number' || typeof rawText !== 'string') return null;
    const textRaw = stripCommentMarkers(rawText);
    const text = textRaw.replace(/;\s*$/, '').trim();
    const mode = normalizeCommentMode((r.mode ?? r.op) as unknown);
    const anchor = typeof r.anchor === 'string' ? r.anchor : null;
    if (!text && mode !== 'remove') return null;
    const instr: CommentInstruction = { line: Math.max(1, Math.floor(line)), text };
    if (mode !== 'upsert') instr.mode = mode;
    if (anchor) instr.anchor = anchor;
    return instr;
}

function dedupeAndSort(list: CommentInstruction[]): CommentInstruction[] {
    const seen = new Set<string>();
    const out: CommentInstruction[] = [];
    for (const c of list) {
        const key = `${c.line}:${c.mode ?? 'upsert'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
    }
    out.sort((a, b) => a.line - b.line);
    return out;
}

export function parseCommentInstructions(raw: string): CommentInstruction[] | null {
    if (!raw) return null;
    let candidate = raw.trim();
    const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) candidate = fenced[1].trim();
    const match = candidate.match(/(\{[\s\S]*\})/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[1]);
        const arr = parsed.comments ?? parsed.edits ?? null;
        if (!Array.isArray(arr)) return null;
        const out = arr.map(extractInstruction).filter((x): x is CommentInstruction => x !== null);
        if (out.length === 0) return null;
        return dedupeAndSort(out);
    } catch {
        return null;
    }
}

/**
 * Apply comment insertions deterministically - POWERFUL VERSION.
 * - Inserts `// text` (or language-appropriate) above each target line.
 * - For functions/classes, uses JSDoc or Python docstring when appropriate.
 * - Preserves indentation, blank lines, and executable code.
 * - Idempotent: if a comment with same text already exists, skip.
 * - Selection-aware: if original has selection context, only comment within that range (handled by caller filtering).
 */
/**
 * Find the index of an existing comment associated with a target line.
 * - If target line itself is a full-line comment, return its index (for "change this comment" where user selected the comment).
 * - Else if line above is a full-line comment, return that index (comment above code).
 * - Else if target line has inline comment, return its index (inline).
 * Returns -1 if no associated comment found — caller should insert new.
 */
export function findAssociatedCommentIndex(
    lines: string[],
    targetIdx: number,
    language: string | null
): number {
    if (targetIdx < 0 || targetIdx >= lines.length) return -1;
    const targetLine = lines[targetIdx];
    // If target itself is a comment line (user selected a comment), that's the one
    if (isCommentLineForLanguage(targetLine, language) && getExecutableLine(targetLine, language) === '') {
        return targetIdx;
    }
    // Check line above — common pattern: comment above code
    if (targetIdx > 0) {
        const above = lines[targetIdx - 1];
        if (isCommentLineForLanguage(above, language) && getExecutableLine(above, language) === '') {
            // Also ensure the comment is not associated with a different code block far away
            // For our purposes, directly above is associated
            return targetIdx - 1;
        }
    }
    // Check inline comment on same line
    const exec = getExecutableLine(targetLine, language);
    if (exec !== targetLine && exec !== '' && targetLine.trim() !== '' && exec.trim() !== targetLine.trim()) {
        // Has inline comment
        return targetIdx;
    }
    return -1;
}

function resolveExistingComment(result: string[], targetIdx: number, language: string | null): number {
    if (targetIdx < 0 || targetIdx >= result.length) return -1;
    if (targetIdx > 0 && isCommentLineForLanguage(result[targetIdx - 1], language) && getExecutableLine(result[targetIdx - 1], language) === '') return targetIdx - 1;
    if (isCommentLineForLanguage(result[targetIdx], language) && getExecutableLine(result[targetIdx], language) === '') return targetIdx;
    const exec = getExecutableLine(result[targetIdx], language);
    if (exec !== result[targetIdx] && exec !== '' && result[targetIdx].trim() !== '') return targetIdx;
    return -1;
}

function isDuplicateComment(normalizedText: string, targetStripped: string): boolean {
    if (!normalizedText || !targetStripped) return false;
    if (normalizedText === targetStripped) return true;
    if (normalizedText.includes('#include') && targetStripped.includes('#include')) {
        const stripped = targetStripped.replace(/^\/\/\s*/, '').replace(/^#\s*/, '');
        if (normalizedText === stripped) return true;
    }
    return false;
}

export function applyCommentInsertions(
    originalCode: string,
    instructions: CommentInstruction[],
    language: string | null,
): string | null {
    if (!originalCode) return null;
    if (instructions.length === 0) return originalCode;
    const lines = originalCode.split('\n');
    const syntax = getCommentSyntax(language);
    const lineMarker = syntax?.line || (language === 'python' ? '#' : '//');
    const sorted = [...instructions].sort((a, b) => b.line - a.line);
    const result = [...lines];
    let changed = 0;

    for (const inst of sorted) {
        const targetIdx = inst.line - 1;
        if (targetIdx < 0 || targetIdx >= lines.length) continue;

        const targetLine = lines[targetIdx] ?? '';
        const normalizedText = stripCommentMarkers(inst.text);
        if (isDuplicateComment(normalizedText, targetLine.trim())) continue;

        const existingIdx = resolveExistingComment(result, targetIdx, language);

        if ((inst.mode ?? 'upsert') === 'remove') {
            if (existingIdx === -1) continue;
            const exec = getExecutableLine(result[existingIdx], language);
            if (existingIdx !== targetIdx || (exec !== result[existingIdx] && exec !== '')) {
                result[existingIdx] = exec.trimEnd();
            } else {
                result.splice(existingIdx, 1);
            }
            changed++;
            continue;
        }

        if (existingIdx !== -1) {
            const existingText = stripCommentMarkers(result[existingIdx]);
            if (existingText === inst.text.trim()) continue;
            result[existingIdx] = buildReplacementComment(result[existingIdx], inst.text, getIndent(targetLine), lineMarker);
            changed++;
            continue;
        }

        const commentLine = buildCommentLine(targetLine, inst.text, language);
        if (result.some(l => l.trim() === commentLine.trim())) continue;
        result.splice(targetIdx, 0, commentLine);
        changed++;
    }
    return changed === 0 ? originalCode : result.join('\n');
}

/**
 * Find the index where a comment starts outside string literals.
 * Returns -1 if no comment marker found outside strings.
 * Handles single-line (//, #, --) and block (/*, <!--) markers, respects quotes and escapes.
 */
function findCommentStartOutsideString(line: string, language: string | null): number {
    const syntax = getCommentSyntax(language);
    const markers: string[] = [];
    if (syntax?.line) markers.push(syntax.line);
    if (syntax?.lineAlt) markers.push(...syntax.lineAlt);
    if (syntax?.blockStart) markers.push(syntax.blockStart);
    if (!syntax || !syntax.supported) {
        // generic fallback for unknown languages
        markers.push('//', '/*', '<!--');
    }
    // Remove empty markers
    const valid = markers.filter(m => m);
    if (valid.length === 0) return -1;

    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && (inSingle || inDouble)) { escaped = true; continue; }
        if (!inSingle && !inDouble && !inBacktick) {
            if (ch === "'") { inSingle = true; continue; }
            if (ch === '"') { inDouble = true; continue; }
            if (ch === '`') { inBacktick = true; continue; }
            // Check for any marker at this position outside strings
            for (const m of valid) {
                if (line.startsWith(m, i)) {
                    // Ensure marker is not part of code like "http://"
                    // For //, ensure it's comment start, not inside string already handled, and preceded by whitespace or start or after code
                    return i;
                }
            }
        } else {
            if (inSingle && ch === "'") inSingle = false;
            else if (inDouble && ch === '"') inDouble = false;
            else if (inBacktick && ch === '`') inBacktick = false;
        }
    }
    return -1;
}

/**
 * Language-aware check if a line is a comment for the given language.
 * Respects string literals: code with // inside string is NOT a comment.
 */
export function isCommentLineForLanguage(line: string, language?: string | null): boolean {
    const t = line.trim();
    if (!t) return false;
    const syntax = getCommentSyntax(language ?? undefined);
    // Quick check: if line starts with marker after trimming, it's a comment line
    if (syntax?.line && t.startsWith(syntax.line)) return true;
    if (syntax?.lineAlt?.some(m => t.startsWith(m))) return true;
    if (syntax?.blockStart && t.startsWith(syntax.blockStart)) return true;
    if (syntax?.blockEnd && t.endsWith(syntax.blockEnd)) return true;
    if (!syntax || !syntax.supported) {
        return t.startsWith('//') || t.startsWith('/*') || t.startsWith('<!--');
    }
    return false;
}

/**
 * Returns the executable code part of a line (without comment), handling strings correctly.
 * For full-line comments returns empty string. For inline comments returns code before comment.
 * For code with // inside string (e.g., printf("a // b")) returns original line.
 */
export function getExecutableLine(line: string, language: string | null): string {
    if (!line.trim()) return '';
    const idx = findCommentStartOutsideString(line, language);
    if (idx === -1) return line;
    // Check if the comment marker is at start (full-line) or inline
    const before = line.slice(0, idx).trim();
    const afterTrim = line.slice(idx).trim();
    const syntax = getCommentSyntax(language);
    const isFullLineComment = before === '' && (
        (syntax?.line && afterTrim.startsWith(syntax.line)) ||
        (syntax?.lineAlt && syntax.lineAlt.some(m => afterTrim.startsWith(m))) ||
        (syntax?.blockStart && afterTrim.startsWith(syntax.blockStart)) ||
        (!syntax || !syntax.supported) && (afterTrim.startsWith('//') || afterTrim.startsWith('/*'))
    );
    if (isFullLineComment) return '';
    // Inline comment: return code part before comment (e.g., "int x=0; // hi" -> "int x=0;")
    // If code before is empty, it's full-line, already handled; otherwise return before part
    // For block commentsInline like "code /* hi */ more", we need to strip block
    // Simple: return before part; block end handling is more complex but we handle single-line block
    const blockStart = syntax?.blockStart || '/*';
    const blockEnd = syntax?.blockEnd || '*/';
    if (line.includes(blockStart) && line.includes(blockEnd) && idx !== -1) {
        // Try to handle inline block: remove from idx to blockEnd
        const endIdx = line.indexOf(blockEnd, idx);
        if (endIdx !== -1) {
            const codePart = (line.slice(0, idx) + line.slice(endIdx + blockEnd.length)).trim();
            return codePart;
        }
    }
    return before ? line.slice(0, idx).trimEnd() : '';
}

/**
 * Remove all comments from code deterministically, preserving strings and code.
 * Language-aware, handles full-line and inline comments outside strings.
 */
export function removeCommentsDeterministically(originalCode: string, language: string | null): string | null {
    if (originalCode == null) return null;
    const lines = originalCode.split('\n');
    const out: string[] = [];
    let inBlock = false;
    const syntax = getCommentSyntax(language);
    const blockStart = syntax?.blockStart || '/*';
    const blockEnd = syntax?.blockEnd || '*/';
    for (const line of lines) {
        // Never remove AI command lines (///) — they are not regular comments
        if (line.trim().startsWith('///')) {
            out.push(line);
            continue;
        }
        if (inBlock) {
            const endIdx = line.indexOf(blockEnd);
            if (endIdx !== -1) {
                // End of block found, keep code after block
                const after = line.slice(endIdx + blockEnd.length);
                const idx2 = findCommentStartOutsideString(after, language);
                // Recursively handle remaining inline on same line
                if (idx2 !== -1) {
                    const codePart = after.slice(0, idx2).trimEnd();
                    if (codePart.trim()) out.push(line.slice(0, line.indexOf(blockStart) !== -1 ? line.indexOf(blockStart) : 0) + codePart);
                } else if (after.trim()) {
                    if (after.trim()) out.push(after);
                }
                inBlock = false;
            }
            // Still in block, skip line
            continue;
        }
        const idx = findCommentStartOutsideString(line, language);
        if (idx === -1) {
            out.push(line);
            continue;
        }
        const before = line.slice(0, idx);
        const after = line.slice(idx);
        // Check if it's a block start that spans multiple lines
        if (after.trim().startsWith(blockStart) && !after.includes(blockEnd)) {
            // Block starts and doesn't end on same line
            if (before.trim()) {
                out.push(before.trimEnd());
            }
            inBlock = true;
            continue;
        }
        // Single-line or inline comment
        // If line is full-line comment (before is whitespace only), skip whole line
        if (before.trim() === '') {
            // Full-line comment — skip
            continue;
        } else {
            // Inline comment — keep code before
            out.push(before.trimEnd());
        }
    }
    // Remove resulting excessive blank lines
    const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n');
    // Preserve trailing newline handling: trimEnd but keep at least one line if original had
    const result = cleaned.trimEnd();
    if (!result.trim()) return null;
    return result;
}

/**
 * Extract comment metadata from a full-file candidate that is supposed to be original + comments.
 * Used to convert a mistaken full-file replacement (containing comments) back into metadata-only ops
 * without duplicating executable code. Returns null if candidate is not a valid comment-only augmentation.
 */
export function extractCommentMetadata(original: string, candidate: string, language: string | null): CommentInstruction[] | null {
    if (!original || !candidate) return null;
    if (!validateCommentPreservation(original, candidate, language)) return null;
    const origLines = original.split('\n');
    const candLines = candidate.split('\n');
    // Candidate should be longer (has extra comment lines) but executable same
    if (candLines.length <= origLines.length) return null;
    const out: CommentInstruction[] = [];
    let origIdx = 0;
    let candIdx = 0;
    while (candIdx < candLines.length && origIdx < origLines.length) {
        const candLine = candLines[candIdx];
        const origLine = origLines[origIdx];
        if (candLine === origLine) {
            // Exact match, advance both
            origIdx++; candIdx++;
        } else if (isCommentLineForLanguage(candLine, language)) {
            // Candidate has a comment line inserted — map to next original line
            // Find next candidate line that matches current original line
            let lookAhead = candIdx + 1;
            while (lookAhead < candLines.length && isCommentLineForLanguage(candLines[lookAhead], language)) {
                lookAhead++;
            }
            if (lookAhead < candLines.length && candLines[lookAhead] === origLine) {
                // This comment is above origLine
                const commentText = candLine.trim()
                    .replace(/^\/\/+\s*/, '').replace(/^#\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();
                if (commentText) {
                    // Line number is 1-based in original
                    out.push({ line: origIdx + 1, text: commentText });
                }
                candIdx++;
            } else {
                // Comment not aligned, try to find matching orig line further ahead
                let found = false;
                for (let k = origIdx; k < origLines.length; k++) {
                    if (origLines[k] === candLine) { found = true; break; }
                    if (candLine.trim() === origLines[k]?.trim() && !isCommentLineForLanguage(candLine, language)) { found = true; break; }
                }
                if (found) {
                    // Duplicate executable — reject
                    return null;
                }
                // Otherwise treat as inserted comment with unknown target — try to map to nearest origIdx+1
                const commentText = candLine.trim()
                    .replace(/^\/\/+\s*/, '').replace(/^#\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();
                if (commentText) {
                    out.push({ line: Math.min(origIdx + 1, origLines.length), text: commentText });
                }
                candIdx++;
            }
        } else if (candLine.trim() === '' && origLine.trim() === '') {
            origIdx++; candIdx++;
        } else {
            // Mismatch and not a comment — likely duplicated code or modification, reject
            return null;
        }
    }
    // Handle trailing comments in candidate
    while (candIdx < candLines.length) {
        const c = candLines[candIdx];
        if (isCommentLineForLanguage(c, language)) {
            const commentText = c.trim()
                .replace(/^\/\/+\s*/, '').replace(/^#\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();
            if (commentText) out.push({ line: origLines.length, text: commentText });
            candIdx++;
        } else if (c.trim() === '') {
            candIdx++;
        } else {
            return null;
        }
    }
    if (out.length === 0) return null;
    // Dedup and sort
    const seen = new Set<number>();
    const dedup: CommentInstruction[] = [];
    for (const c of out) {
        if (seen.has(c.line)) continue;
        seen.add(c.line);
        dedup.push(c);
    }
    dedup.sort((a, b) => a.line - b.line);
    return dedup;
}

/**
 * Validate that comment insertion preserved executable code exactly.
 * Language-aware: for C, #include is NOT a comment. Handles strings and inline comments.
 */
export function validateCommentPreservation(original: string, candidate: string, language?: string | null): boolean {
    const lang = language ?? null;
    const strip = (code: string): string => code.split('\n').map(l => getExecutableLine(l, lang).trim()).filter(t => t !== '').join('\n');
    return strip(original) === strip(candidate);
}

/**
 * Count executable lines, language-aware.
 */
export function countExecutableLines(code: string, language?: string | null): number {
    const lang = language ?? null;
    return code.split('\n').map(l => getExecutableLine(l, lang).trim()).filter(t => t !== '').length;
}
