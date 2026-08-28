/**
 * Edit Validator — safety gate before any Monaco commit.
 *
 * - Duplicate detection
 * - Line-shift safety (bottom-to-top)
 * - Executable-code preservation for comments-only
 * - Malformed syntax guard
 * - Accidental duplication guard
 */

import { countExecutableLines, validateCommentPreservation } from './commentApplier';
import { getCommentSyntax } from './commentSyntax';

export interface ValidationResult {
    ok: boolean;
    reason?: string;
}

export function isDuplicateComment(originalCode: string, line: number, text: string, language: string | null): boolean {
    const lines = originalCode.split('\n');
    const syntax = getCommentSyntax(language);
    const marker = syntax?.line || (language === 'python' ? '#' : '//');
    const targetIdx = line - 1;
    if (targetIdx < 0 || targetIdx >= lines.length) return false;
    const targetLine = lines[targetIdx] ?? '';
    const indent = targetLine.match(/^[ \t]*/)?.[0] ?? '';
    const candidate = `${indent}${marker} ${text}`.trim();
    // Check if same comment already exists directly above or anywhere
    if (targetIdx > 0 && lines[targetIdx - 1]?.trim() === candidate) return true;
    if (lines.some(l => l.trim() === candidate)) return true;
    return false;
}

export function validateAddComments(
    originalCode: string,
    candidateCode: string,
    language: string | null,
    requestedOps: Array<{ line: number; text: string }>
): ValidationResult {
    // 1. Executable must be preserved
    if (!validateCommentPreservation(originalCode, candidateCode, language)) {
        return { ok: false, reason: 'Executable code would be altered by comment insertion — rejected' };
    }
    // 2. No accidental line duplication (original lines must appear in order in candidate, ignoring inserted comments)
    const stripComments = (code: string): string[] => code.split('\n').filter(l => {
        const t = l.trim();
        if (!t) return false;
        const syntax = getCommentSyntax(language);
        if (syntax?.line && t.startsWith(syntax.line)) return false;
        if (syntax?.lineAlt?.some(m => t.startsWith(m))) return false;
        if (syntax?.blockStart && t.startsWith(syntax.blockStart)) return false;
        if (!syntax || !syntax.supported) {
            if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*')) return false;
        }
        return true;
    }).map(l => l.trim());

    const origExec = stripComments(originalCode);
    const candExec = stripComments(candidateCode);
    if (origExec.length !== candExec.length || origExec.join('\n') !== candExec.join('\n')) {
        return { ok: false, reason: 'Unrelated executable code would be changed — rejected' };
    }

    // 3. Duplicate check — if all requested comments already exist, treat as no-op but not error
    let allDuplicate = true;
    for (const op of requestedOps) {
        if (!isDuplicateComment(originalCode, op.line, op.text, language)) {
            allDuplicate = false;
            break;
        }
    }
    if (allDuplicate && requestedOps.length > 0) {
        return { ok: true, reason: 'All requested comments already exist — no change needed' };
    }

    // 4. Line numbers must be in range
    const lineCount = originalCode.split('\n').length;
    for (const op of requestedOps) {
        if (op.line < 1 || op.line > lineCount) {
            return { ok: false, reason: `Comment line ${op.line} out of range (1-${lineCount})` };
        }
    }

    return { ok: true };
}

export function validateRemoveComments(
    originalCode: string,
    candidateCode: string,
    language: string | null
): ValidationResult {
    // Must preserve executable
    const origExec = countExecutableLines(originalCode, language);
    const candExec = countExecutableLines(candidateCode, language);
    if (origExec !== candExec) {
        return { ok: false, reason: 'Executable lines would be removed — only comments should be removed' };
    }
    if (!candidateCode.trim()) {
        return { ok: false, reason: 'File would become empty — rejected' };
    }
    // No malformed: candidate must not have consecutive duplicate blank lines excessive
    if (/\n{4,}/.test(candidateCode)) {
        return { ok: false, reason: 'Malformed candidate with excessive blank lines' };
    }
    return { ok: true };
}

export function validateNoAccidentalDuplication(originalCode: string, candidateCode: string): ValidationResult {
    // Cheap check: if candidate contains original line duplicated adjacent due to bad splice
    const origLines = originalCode.split('\n');
    const candLines = candidateCode.split('\n');
    // If candidate length > orig length + inserted ops + 5, likely duplication
    // This is a heuristic; actual applier handles bottom-to-top so shouldn't happen
    if (candLines.length > origLines.length * 2 && candLines.length > origLines.length + 20) {
        return { ok: false, reason: 'Candidate appears to duplicate large sections — rejected' };
    }
    return { ok: true };
}

export function validateCandidateNotMalformed(candidateCode: string): ValidationResult {
    if (!candidateCode.trim()) return { ok: false, reason: 'Candidate is empty' };
    // Balanced brackets heuristic for JS/TS/C/Java/Python parens
    const open = (candidateCode.match(/\{/g) || []).length;
    const close = (candidateCode.match(/\}/g) || []).length;
    if (Math.abs(open - close) > 5) {
        return { ok: false, reason: 'Candidate has mismatched braces — possible malformed edit' };
    }
    return { ok: true };
}
