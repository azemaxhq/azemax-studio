/**
 * AICodeNormalizer — the single source of truth for turning AI-generated text
 * into code that is SAFE and correctly indented for the editor.
 *
 * Guarantees (enforced here, nowhere else):
 *   - CRLF/CR line endings become LF.
 *   - AI reasoning / thinking blocks are removed (chunk-safe on the complete
 *     response; never applied to individual stream chunks).
 *   - Markdown fences are converted safely — interior indentation is preserved
 *     and backticks inside strings are never treated as fences.
 *   - Blank lines are preserved; comments and strings are preserved verbatim.
 *   - Indentation is repaired ONLY for indentation-semantic languages (Python),
 *     and only for the narrow, deterministic mis-indentation signatures listed
 *     on `repairPythonIndentation` (dedented body before a closer, empty-block
 *     first body, nested header emitted as a first body, and a closer dedented
 *     below its block). No arbitrary global trim / dedent / re-indent.
 *   - The operation is O(n) in the response size.
 *
 * Streaming contract: this module operates on a COMPLETE logical response only.
 * Stream callers must accumulate raw chunks, then run the response through
 * `normalizeGeneratedCode` once, before applying anything to the editor.
 */

import {
    stripAllReasoning,
    stripInlineThinking,
    sanitizeEditorOutput,
} from './AIResponseParser';
import {
    createPythonScanner,
    detectIndentUnit,
    normalizePythonLanguage,
    pythonIndentWidth,
    PYTHON_BLOCK_CLOSERS,
    type PythonLineInfo,
} from './languageIndentation';

export interface NormalizeOptions {
    language?: string | null;
    filename?: string | null;
    /** Original file/snippet content; only used for context (currently unused). */
    preserve?: string | null;
}

/** CRLF / CR -> LF. Idempotent. */
export const normalizeLineEndings = (code: string): string =>
    code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const FENCE_LINE_RE = /^[ \t]*```[^\n]*$/;

/**
 * Removes markdown code fences ONLY when the text starts with a fence line and
 * a matching fence exists. Interior content (including its indentation and any
 * backticks inside strings) is preserved verbatim. Unmatched fences inside code
 * are left alone — backticks that are not at line start are never touched.
 */
export const stripMarkdownFences = (code: string): string => {
    const lines = code.split('\n');
    let first = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '') {
            first = i;
            break;
        }
    }
    if (first === -1 || !FENCE_LINE_RE.test(lines[first])) return code;

    let last = -1;
    for (let i = lines.length - 1; i >= first; i--) {
        if (FENCE_LINE_RE.test(lines[i])) {
            last = i;
            break;
        }
    }
    if (last <= first) {
        const copy = [...lines];
        copy.splice(first, 1);
        return copy.join('\n');
    }
    return lines.slice(first + 1, last).join('\n');
};

// ============================================================================
// Python block-indent repair
// ============================================================================

interface OpenBlock {
    indent: number;
    closers: string[];
    sawBody: boolean;
}

const isCloserFor = (info: PythonLineInfo, block: OpenBlock): boolean =>
    !!info.closerKeyword && block.closers.includes(info.closerKeyword);

/**
 * Looks ahead from `fromIndex` to decide whether `block` will still be closed
 * by one of its closers at the block's header indent before any line dedents
 * below the header. Used to distinguish a misplaced (dedented) body statement
 * from a genuinely ended block.
 */
const blockWillCloseWithCloser = (
    infos: PythonLineInfo[],
    fromIndex: number,
    block: OpenBlock,
): boolean => {
    for (let j = fromIndex; j < infos.length; j++) {
        const info = infos[j];
        if (!info.hasCode) continue;
        if (info.indent > block.indent) continue;
        if (info.indent < block.indent) return false;
        if (isCloserFor(info, block)) return true;
    }
    return false;
};

/**
 * Deterministic repair for AI-generated Python indentation. Repairs ONLY the
 * narrow, provable mis-indentation signatures while leaving every valid line
 * byte-for-byte intact:
 *
 *   1. A body statement dedented to (or below) its block header while the
 *      block is still open (a closer for it still follows at the header
 *      indent) — the try/except and `print`-after-`if` classes of bug.
 *   2. The first body statement of a freshly-opened block emitted at (or
 *      below) the header indent — the empty-block / `def foo():` + `return`
 *      class of bug.
 *   3. A block header (or closer) emitted as the first body of a freshly
 *      opened block (e.g. `class Foo:` + `def hello(self):`) — re-indented
 *      into the block so nested blocks gain one level.
 *   4. A closer (`elif`/`else`/`except`/`finally`) emitted BELOW its block's
 *      header with no outer open block at its own indent — re-aligned with
 *      its opener. When an outer block at the closer's own indent can accept
 *      it, the closer is left where it is (it legitimately closes that block).
 *
 * Never touches blank lines, comments, strings, or any other indentation.
 * The operation is O(n) with bounded lookahead.
 */
export const repairPythonIndentation = (code: string): string => {
    const lines = code.split('\n');
    const scanner = createPythonScanner();
    const infos = lines.map((l) => scanner.scanLine(l));
    const unit = detectIndentUnit(infos);
    const stack: OpenBlock[] = [];
    const out = [...lines];

    for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info.hasCode) continue;

        const indent = info.indent;
        let reindentedTo: number | null = null;
        let consumed = false;

        while (stack.length > 0 && !consumed) {
            const top = stack[stack.length - 1];

            if (indent > top.indent) {
                // Ordinary body statement (or sibling block) of `top`.
                top.sawBody = true;
                consumed = true;
                break;
            }

            if (indent === top.indent) {
                if (isCloserFor(info, top)) {
                    // Correctly aligned closer terminates the block.
                    stack.pop();
                    consumed = true;
                    break;
                }
                if (!info.isBlockHeader && blockWillCloseWithCloser(infos, i + 1, top)) {
                    // Body statement dedented to its header level while a
                    // closer still follows at that indent.
                    reindentedTo = top.indent + unit;
                    top.sawBody = true;
                    consumed = true;
                    break;
                }
                if (!top.sawBody && !info.closerKeyword) {
                    // First body statement (or first nested header) emitted at
                    // the header indent — a freshly opened block needs a body.
                    reindentedTo = top.indent + unit;
                    top.sawBody = true;
                    consumed = true;
                    break;
                }
                stack.pop();
                continue;
            }

            // indent < top.indent — dedented below the innermost header.
            if (isCloserFor(info, top)) {
                // A closer dedented below its block's header. If an OUTER
                // open block sits at the closer's own indent and can accept
                // it, the closer is legitimately aligned there — pop down to
                // it. Otherwise the closer is misaligned and is re-aligned
                // with its opener.
                let acceptAtOwnLevel = false;
                for (let k = stack.length - 1; k >= 0; k--) {
                    if (stack[k].indent < info.indent) break;
                    if (stack[k].indent === info.indent && isCloserFor(info, stack[k])) {
                        acceptAtOwnLevel = true;
                        break;
                    }
                }
                if (acceptAtOwnLevel) {
                    stack.pop();
                    continue;
                }
                reindentedTo = top.indent;
                stack.pop();
                consumed = true;
                break;
            }
            if (!info.isBlockHeader && blockWillCloseWithCloser(infos, i + 1, top)) {
                // Body statement dedented below its header while the block is
                // still open (closer follows at the header indent).
                reindentedTo = top.indent + unit;
                top.sawBody = true;
                consumed = true;
                break;
            }
            if (!top.sawBody && !info.closerKeyword) {
                // First body statement emitted below the header of a freshly
                // opened block.
                reindentedTo = top.indent + unit;
                top.sawBody = true;
                consumed = true;
                break;
            }
            stack.pop();
        }

        let effectiveIndent = indent;
        if (reindentedTo !== null) {
            const leading = pythonIndentWidth(lines[i]);
            out[i] = ' '.repeat(reindentedTo) + lines[i].slice(leading);
            effectiveIndent = reindentedTo;
        }

        if (info.isBlockHeader) {
            stack.push({
                indent: effectiveIndent,
                closers: info.keyword ? PYTHON_BLOCK_CLOSERS[info.keyword] ?? [] : [],
                sawBody: false,
            });
        }
    }

    return out.join('\n');
};

/**
 * Normalizes AI-generated code for editor insertion.
 *
 * Pipeline: line endings -> reasoning removal -> safe fence conversion ->
 * (Python) deterministic block-indent repair. Input that is not Python is
 * never re-indented. Strings, comments, blank lines and interior indentation
 * are preserved; nothing is globally trimmed or dedented.
 */
export const normalizeGeneratedCode = (raw: string, options: NormalizeOptions = {}): string => {
    if (!raw) return '';

    let code = normalizeLineEndings(raw);

    // Reasoning/thinking removal on the complete response.
    code = stripAllReasoning(code);
    code = stripInlineThinking(code).trim();

    // Safe markdown-fence conversion (string-aware by construction).
    code = stripMarkdownFences(code);

    // Deterministic indentation repair for indentation-semantic languages.
    if (normalizePythonLanguage(options.language)) {
        code = repairPythonIndentation(code);
    }

    return code;
};

/**
 * Compatibility: base editor sanitizer plus normalization, without the
 * language-aware comment policy. Kept for callers that only need the strict
 * editor-safe path; language-aware callers should use
 * `normalizeGeneratedCode` (which also handles Python indentation repair).
 */
export const sanitizeAndNormalizeEditorOutput = (raw: string): string => {
    if (!raw) return '';
    return normalizeGeneratedCode(sanitizeEditorOutput(raw));
};