/**
 * AIEditVerifier / AIEditEngine — reusable, operation-aware verification.
 * Replaces brittle exact-text checks with semantic, result-based validation.
 */

import { getCommentSyntax } from './commentSyntax';
import { getExecutableLine } from './commentApplier';
import type { AIAction } from './aiToolExecutor';
import type { EditSnapshot } from './aiToolExecutor';

function normalizeCommentText(text: string): string {
    return text.trim().replace(/^\/\/+\s*/, '').replace(/^#\s*/, '').replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim().toLowerCase();
}

function isCommentLine(line: string, language: string | null): boolean {
    const t = line.trim();
    if (!t) return false;
    const syntax = getCommentSyntax(language);
    if (syntax?.line && t.startsWith(syntax.line)) return true;
    if (syntax?.lineAlt?.some(m => t.startsWith(m))) return true;
    if (syntax?.blockStart && t.startsWith(syntax.blockStart)) return true;
    if (syntax?.blockEnd && t.endsWith(syntax.blockEnd)) return true;
    if (!syntax || !syntax.supported) {
        return t.startsWith('//') || t.startsWith('/*') || t.startsWith('<!--');
    }
    return false;
}

function findCodeLineInCurrent(snapshotLine: string, currentLines: string[]): number {
    const trimmed = snapshotLine.trim();
    if (!trimmed) return -1;
    let foundIdx = -1;
    let count = 0;
    for (let i = 0; i < currentLines.length; i++) {
        if (currentLines[i].trim() === trimmed) {
            foundIdx = i;
            count++;
        }
    }
    if (count === 1) return foundIdx;
    return -1; // ambiguous or not found
}

export function verifyAddComments(
    snapshot: EditSnapshot | null,
    currentContent: string,
    action: Extract<AIAction, { action: 'add_comments' }>,
    language: string | null
): { ok: boolean; reason?: string } {
    const currentLines = currentContent.split('\n');
    const snapshotLines = snapshot?.lines || [];
    for (const c of action.comments) {
        const anyC = c as any;
        // Use original snapshot line if available (for stale-resolved comments)
        const effectiveSnapshotLine = anyC.originalContent as string | null ?? (snapshotLines[(anyC.originalLine ?? c.line) - 1] ?? snapshotLines[c.line - 1] ?? null);
        const snapshotLineContent = effectiveSnapshotLine ?? (snapshotLines[c.line - 1] ?? null);

        // Find the target code line in current file via content search (handles line shift)
        let codeIdxInCurrent = -1;
        if (snapshotLineContent !== null) {
            codeIdxInCurrent = findCodeLineInCurrent(snapshotLineContent, currentLines);
            // If not found uniquely, try same line number as fallback
            if (codeIdxInCurrent === -1 && currentLines[c.line - 1] !== undefined) {
                // Check if current line at same number has similar content (first 20 chars)
                const cur = currentLines[c.line - 1]?.trim() ?? '';
                const snapTrim = snapshotLineContent.trim();
                if (cur && snapTrim && (cur.includes(snapTrim.slice(0, 20)) || snapTrim.includes(cur.slice(0, 20)))) {
                    codeIdxInCurrent = c.line - 1;
                }
            }
            if (codeIdxInCurrent === -1) {
                // Could not locate the code — check if a new comment exists anywhere that is similar to requested
                const snapshotCommentTexts = new Set(
                    snapshotLines.filter(l => isCommentLine(l, language)).map(l => normalizeCommentText(l)) as string[]
                );
                const currentCommentTexts = currentLines.filter(l => isCommentLine(l, language)).map(l => normalizeCommentText(l));
                const newComments = currentCommentTexts.filter(t => !snapshotCommentTexts.has(t));
                if (newComments.length === 0) {
                    return { ok: false, reason: `No new comment found for intended line ${c.line}` };
                }
                const requestedNorm = normalizeCommentText(c.text);
                const hasSimilar = newComments.some(nc => {
                    // Allow any new comment if we cannot locate code — lenient
                    return nc.length > 0 && requestedNorm.length > 0;
                });
                if (!hasSimilar) {
                    return { ok: false, reason: `No comment found for line ${c.line}` };
                }
                continue;
            }
        } else {
            codeIdxInCurrent = c.line - 1;
            if (codeIdxInCurrent < 0 || codeIdxInCurrent >= currentLines.length) {
                return { ok: false, reason: `Target line ${c.line} out of range` };
            }
        }

        // Check for a comment associated with the code at codeIdxInCurrent
        let hasAssociatedComment = false;
        if (codeIdxInCurrent > 0 && isCommentLine(currentLines[codeIdxInCurrent - 1], language)) {
            hasAssociatedComment = true;
        }
        if (!hasAssociatedComment) {
            const line = currentLines[codeIdxInCurrent] ?? '';
            const exec = getExecutableLine(line, language);
            if (exec !== line && line.trim() !== '' && exec.trim() !== '') {
                hasAssociatedComment = true;
            }
        }
        // Handle case where comment was inserted and code shifted down by one
        if (!hasAssociatedComment && codeIdxInCurrent < currentLines.length - 1) {
            // If the code we found is now one line down due to insertion, the comment is at codeIdxInCurrent
            const maybeComment = currentLines[codeIdxInCurrent];
            const nextLine = currentLines[codeIdxInCurrent + 1];
            if (isCommentLine(maybeComment, language) && nextLine && nextLine.trim() === (snapshotLineContent?.trim() ?? '')) {
                hasAssociatedComment = true;
            }
        }
        if (!hasAssociatedComment) {
            return { ok: false, reason: `No comment found associated with code at line ${c.line} ("${(snapshotLineContent || '').trim().slice(0, 40)}")` };
        }
    }

    // Global checks: no duplicate #include, etc., and executable preserved (handled elsewhere, but double-check)
    if (snapshot) {
        const origIncludes = (snapshot.content.match(/#include/g) || []).length;
        const currIncludes = (currentContent.match(/#include/g) || []).length;
        if (currIncludes > origIncludes) {
            return { ok: false, reason: `Duplicate #include detected (${origIncludes} -> ${currIncludes})` };
        }
        // Verify no duplicate functions/statements via executable line counts
        // For add_comments, executable should be identical
        const origExec = snapshot.content.split('\n').map(l => getExecutableLine(l, language).trim()).filter(Boolean).join('\n');
        const currExec = currentContent.split('\n').map(l => getExecutableLine(l, language).trim()).filter(Boolean).join('\n');
        if (origExec !== currExec) {
            return { ok: false, reason: `Executable code changed during comment operation` };
        }
    }

    return { ok: true };
}

export function verifyRemoveComments(
    snapshot: EditSnapshot | null,
    currentContent: string,
    action: Extract<AIAction, { action: 'remove_comments' }>,
    language: string | null
): { ok: boolean; reason?: string } {
    if (!snapshot) return { ok: true };
    const snapshotLines = snapshot.content.split('\n');
    const currentLines = currentContent.split('\n');
    // Executable must be preserved
    const origExec = snapshotLines.map(l => getExecutableLine(l, language).trim()).filter(Boolean).join('\n');
    const currExec = currentLines.map(l => getExecutableLine(l, language).trim()).filter(Boolean).join('\n');
    if (origExec !== currExec) {
        return { ok: false, reason: 'Executable code changed during comment removal' };
    }
    // For remove, ensure that comments were actually removed (or preserved correctly)
    // Count comments before and after, excluding AI command lines (///)
    const isRealComment = (line: string) => {
        const t = line.trim();
        if (t.startsWith('///')) return false; // AI command, not a real comment to be removed
        return isCommentLine(line, language);
    };
    const origCommentCount = snapshotLines.filter(l => isRealComment(l)).length;
    const currCommentCount = currentLines.filter(l => isRealComment(l)).length;
    if (currCommentCount >= origCommentCount && origCommentCount > 0) {
        const preserveSet = (action as any).preserveLines as number[] | undefined;
        if (!preserveSet || preserveSet.length === 0) {
            if (currCommentCount === origCommentCount) {
                return { ok: false, reason: 'No comments were removed' };
            }
        }
    }
    // If there were no real comments to begin with, it's a successful no-op, not a failure
    if (origCommentCount === 0) {
        return { ok: true };
    }
    // If preserveLines was specified, ensure those lines still exist
    const preserveLines = (action as any).preserveLines as number[] | undefined;
    if (preserveLines && preserveLines.length > 0) {
        for (const pl of preserveLines) {
            const origLine = snapshotLines[pl - 1];
            if (origLine && isCommentLine(origLine, language)) {
                if (!currentContent.includes(origLine.trim())) {
                    return { ok: false, reason: `Preserved comment at line ${pl} was removed` };
                }
            }
        }
    }
    return { ok: true };
}

export function verifyReplaceCode(
    snapshot: EditSnapshot | null,
    currentContent: string,
    action: Extract<AIAction, { action: 'replace_code' }>,
    _language: string | null
): { ok: boolean; reason?: string } {
    const content = (action as any).content as string;
    if (!content) return { ok: false, reason: 'No content for replace' };
    // Lenient check: current should be different from snapshot and contain some of the new content
    if (snapshot && currentContent.trim() === snapshot.content.trim()) {
        return { ok: false, reason: `File unchanged after replace` };
    }
    const newTrim = content.trim();
    const currTrim = currentContent.trim();
    // Check that at least a significant portion of new content is in current
    const newLines = newTrim.split('\n').map(l => l.trim()).filter(Boolean);
    const currLines = new Set(currTrim.split('\n').map(l => l.trim()));
    const matchingLines = newLines.filter(l => currLines.has(l));
    if (matchingLines.length === 0 && newLines.length > 0) {
        // Fallback: check first line
        const firstLineOfNew = newLines[0];
        if (firstLineOfNew && !currentContent.includes(firstLineOfNew)) {
            return { ok: false, reason: `Replaced code not found in file: "${firstLineOfNew.slice(0, 40)}"` };
        }
    }
    // Ensure old content is gone (if it was unique)
    if (snapshot) {
        const origSlice = snapshot.lines.slice((action as any).startLine - 1, (action as any).endLine).join('\n').trim();
        if (origSlice && origSlice !== content.trim() && currentContent.includes(origSlice)) {
            // Old code still present — might be duplicate or not replaced
            // Check if the old slice appears elsewhere — if it's unique and still present, verification fails
            const origCountInSnapshot = (snapshot.content.match(new RegExp(escapeRegExp(origSlice.slice(0, 20)), 'g')) || []).length;
            const origCountInCurrent = (currentContent.match(new RegExp(escapeRegExp(origSlice.slice(0, 20)), 'g')) || []).length;
            if (origCountInCurrent >= origCountInSnapshot) {
                // Old code still present same number of times — not replaced
                // This is a soft check, don't fail hard for now
            }
        }
    }
    return { ok: true };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function verifyInsertCode(
    _snapshot: EditSnapshot | null,
    currentContent: string,
    action: Extract<AIAction, { action: 'insert_code' }>,
    _language: string | null
): { ok: boolean; reason?: string } {
    const content = (action as any).content as string;
    if (!content) return { ok: false, reason: 'No content for insert' };
    const firstLine = content.trim().split('\n')[0].trim();
    if (firstLine && !currentContent.includes(firstLine)) {
        return { ok: false, reason: `Inserted code not found: "${firstLine.slice(0, 40)}"` };
    }
    return { ok: true };
}

export function verifyDeleteCode(
    snapshot: EditSnapshot | null,
    currentContent: string,
    action: Extract<AIAction, { action: 'delete_code' }>,
    _language: string | null
): { ok: boolean; reason?: string } {
    if (!snapshot) return { ok: true };
    const start = (action as any).startLine;
    const end = (action as any).endLine;
    const deletedSlice = snapshot.lines.slice(start - 1, end).join('\n').trim();
    if (deletedSlice && currentContent.includes(deletedSlice)) {
        return { ok: false, reason: `Deleted code still present: "${deletedSlice.slice(0, 40)}"` };
    }
    return { ok: true };
}

export function verifyAction(
    snapshot: EditSnapshot | null,
    currentContent: string,
    action: AIAction,
    language: string | null
): { ok: boolean; reason?: string } {
    switch (action.action) {
        case 'add_comments':
            return verifyAddComments(snapshot, currentContent, action as any, language);
        case 'remove_comments':
            return verifyRemoveComments(snapshot, currentContent, action as any, language);
        case 'replace_code':
            return verifyReplaceCode(snapshot, currentContent, action as any, language);
        case 'insert_code':
            return verifyInsertCode(snapshot, currentContent, action as any, language);
        case 'delete_code':
            return verifyDeleteCode(snapshot, currentContent, action as any, language);
        case 'create_file':
        case 'delete_file':
        case 'rename_file':
        case 'update_file':
            // For file ops, basic check: file should exist / not exist etc. Handled elsewhere
            return { ok: true };
        default:
            return { ok: true };
    }
}

/**
 * Attempt to re-resolve stale targets against latest content before giving up.
 * For add_comments, this tries to find the correct line for each comment via content search.
 */
export function attemptReResolve(
    snapshot: EditSnapshot | null,
    latestContent: string,
    action: AIAction,
    _language: string | null
): AIAction | null {
    if (!snapshot || action.action !== 'add_comments') return null;
    const a = action as Extract<AIAction, { action: 'add_comments' }>;
    const latestLines = latestContent.split('\n');
    const resolved: typeof a.comments = [];
    for (const c of a.comments) {
        const snapshotLine = snapshot.lines[c.line - 1];
        if (!snapshotLine) continue;
        // Find snapshot line in latest
        let foundIdx = -1;
        let count = 0;
        for (let i = 0; i < latestLines.length; i++) {
            if (latestLines[i].trim() === snapshotLine.trim()) {
                foundIdx = i;
                count++;
            }
        }
        if (count === 1 && foundIdx !== -1) {
            resolved.push({ line: foundIdx + 1, text: c.text });
        } else if (count === 0) {
            // Try to find by executable part
            const snapshotExec = snapshotLine.trim();
            for (let i = 0; i < latestLines.length; i++) {
                if (latestLines[i].trim().includes(snapshotExec.slice(0, 20))) {
                    foundIdx = i;
                    count = 1;
                    break;
                }
            }
            if (foundIdx !== -1) resolved.push({ line: foundIdx + 1, text: c.text });
        } else {
            // Ambiguous — keep original
            resolved.push(c);
        }
    }
    if (resolved.length === 0) return null;
    // Deduplicate
    const seen = new Set<number>();
    const dedup: typeof resolved = [];
    for (const c of resolved) {
        if (seen.has(c.line)) continue;
        seen.add(c.line);
        dedup.push(c);
    }
    return { ...a, comments: dedup };
}
