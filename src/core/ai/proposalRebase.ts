/**
 * Proposal rebase — safe recovery when a file changed since an AI proposal.
 *
 * `handleAcceptProposal` previously compared the proposal's captured `before`
 * content against the live file with strict byte equality. ANY divergence
 * (a user keystroke auto-synced into the tree, line-ending normalization by
 * another writer, an unrelated concurrent AI edit) refused the whole change:
 * "No changes applied — 1 skipped (file changed since proposal)."
 *
 * This module adds the missing middle ground: when the user's newer content
 * still contains the exact region the proposal intended to change, the change
 * can be REBASED onto the live file without discarding the user's edits.
 *
 * Safety rules:
 *  - The proposed region must occur EXACTLY (byte-for-byte) in the live file.
 *  - It must be unambiguous (a unique match, or a single match whose
 *    surrounding context matches the proposal's context).
 *  - Insertions additionally anchor on the first line of the unchanged tail;
 *    if the anchor is missing or duplicated, the rebase is refused.
 *  - Anything else returns `null` and the caller must treat it as a real
 *    conflict (never overwrite the live file, offer regeneration instead).
 *
 * Pure functions only — no filesystem, no Monaco, no React.
 */

/** Canonical comparison form: CRLF→LF and one trailing-newline tolerance. */
export function normalizeForCompare(s: string | null | undefined): string {
    if (!s) return '';
    const lf = s.replace(/\r\n/g, '\n');
    return lf.length > 0 && lf.endsWith('\n')
        ? lf.slice(0, -1)
        : lf;
}

/** True when the two contents are the same modulo line-ending normalization. */
export function contentEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return normalizeForCompare(a) === normalizeForCompare(b);
}

function splitLines(s: string): string[] {
    return normalizeForCompare(s).split('\n');
}

export interface RebaseResult {
    /** Rebased full file content, or null when the rebase is unsafe. */
    rebased: string | null;
    /** Short explanation for the caller's user-facing message. */
    reason?: string;
}

function findOccurrences(haystack: string[], needle: string[]): number[] {
    const idxs: number[] = [];
    if (needle.length === 0 || haystack.length === 0) return idxs;
    outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        idxs.push(i);
    }
    return idxs;
}

/** Longest common prefix length (in lines) of two line arrays. */
function commonPrefix(a: string[], b: string[], limit?: number): number {
    const cap = Math.min(limit ?? a.length, a.length, b.length);
    let n = 0;
    while (n < cap && a[n] === b[n]) n++;
    return n;
}

/** Longest common suffix length (in lines) of two line arrays. */
function commonSuffix(a: string[], b: string[], limit?: number): number {
    const cap = Math.min(limit ?? a.length, a.length, b.length);
    let n = 0;
    while (n < cap && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
}

/**
 * Attempt to apply the (before → after) edit onto `live`.
 *
 * `expectedStartLine` is 0-based and positions the change as it existed in the
 * proposal — used only to DISAMBIGUATE repeated candidate regions.
 */
export function tryRebaseUpdate(before: string, after: string, live: string, expectedStartLine = 0): RebaseResult {
    if (live == null) return { rebased: null, reason: 'file missing' };

    const beforeLines = before == null ? [] : splitLines(before);
    const afterLines = after == null ? [] : splitLines(after);
    const liveLines = splitLines(live);

    // Whole-file no-op / identical content is handled by the caller.
    if (normalizeForCompare(before) === normalizeForCompare(live)) {
        return { rebased: after }; // live unchanged (modulo endings) — proposal applies cleanly
    }

    // Trim the unchanged context around the intended edit so the rebase only
    // needs to locate the actually-changed region.
    const midPrefix = commonPrefix(beforeLines, afterLines);
    let midSuffix = commonSuffix(beforeLines, afterLines);
    // The suffix must not overlap the prefix (empty middle in the middle).
    if (midPrefix + midSuffix > Math.min(beforeLines.length, afterLines.length)) {
        midSuffix = Math.min(beforeLines.length, afterLines.length) - midPrefix;
    }

    const headLines = beforeLines.slice(0, midPrefix);
    const tailLines = beforeLines.slice(beforeLines.length - midSuffix);
    const midBefore = beforeLines.slice(midPrefix, beforeLines.length - midSuffix);
    const midAfter = afterLines.slice(midPrefix, afterLines.length - midSuffix);

    // Pure insertion (nothing removed): anchor on the following (tail) lines.
    if (midBefore.length === 0) {
        if (midAfter.length === 0) {
            // Nothing actually changes — caller normalizes this away.
            return { rebased: live };
        }
        if (tailLines.length === 0) {
            // Appending at the end of an otherwise-identical file: the insert
            // goes after whatever the user wrote — the proposal intended the
            // end of the file, and the user's appended lines came later.
            return { rebased: [...liveLines, ...midAfter].join('\n') };
        }
        const anchors = findOccurrences(liveLines, tailLines);
        if (anchors.length === 0) return { rebased: null, reason: 'the surrounding context moved — the insertion point could not be located' };
        if (anchors.length > 1) return { rebased: null, reason: 'the insertion point is ambiguous in the current file' };
        const at = anchors[0];
        const merged = [...liveLines.slice(0, at), ...midAfter, ...liveLines.slice(at)];
        return { rebased: merged.join('\n') };
    }

    // Replacement or deletion: the removed region must appear EXACTLY in live.
    const occurrences = findOccurrences(liveLines, midBefore);
    if (occurrences.length === 0) {
        return { rebased: null, reason: 'that part of the file changed since the proposal was generated' };
    }
    if (occurrences.length === 1) {
        const at = occurrences[0];
        const merged = [...liveLines.slice(0, at), ...midAfter, ...liveLines.slice(at + midBefore.length)];
        return { rebased: merged.join('\n') };
    }

    // Multiple candidates: pick the one whose surrounding context matches the
    // proposal, as positioned by `expectedStartLine`.
    const scored = occurrences.map(at => {
        const ctxBefore = commonPrefix(liveLines.slice(Math.max(0, at - headLines.length), at), headLines.slice(-Math.min(headLines.length, at)));
        const ctxAfter = commonSuffix(liveLines.slice(at + midBefore.length, at + midBefore.length + tailLines.length), tailLines.slice(0, Math.min(tailLines.length, midSuffix)));
        const positionPenalty = Math.abs(at - expectedStartLine);
        return { at, score: ctxBefore + ctxAfter, positionPenalty };
    });
    const best = scored.reduce((a, b) => {
        const total = (x: typeof a) => x.score * 1000 + 500 - x.positionPenalty;
        return total(b) > total(a) ? b : a;
    });
    const bestScore = scored.filter(s => s.score === best.score);
    if (bestScore.length !== 1) {
        return { rebased: null, reason: 'the change matches several locations in the current file — re-run the request against the latest content' };
    }
    const at = best.at;
    const merged = [...liveLines.slice(0, at), ...midAfter, ...liveLines.slice(at + midBefore.length)];
    return { rebased: merged.join('\n') };
}

/**
 * Whether a 'create' proposal can still be applied: only when no file exists
 * at that path in the live tree walks (`existsAtPath` = true means skip).
 */
export function canCreateStillApply(existsAtPath: boolean): boolean {
    return !existsAtPath;
}
