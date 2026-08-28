/**
 * AICodeValidator — the final gate before AI-generated code reaches the editor.
 *
 * Runs AFTER `AICodeNormalizer.normalizeGeneratedCode` on the complete
 * response. Detects, deterministically (O(n), no model, no formatter):
 *   - reasoning / thinking leakage that would otherwise reach Monaco;
 *   - markdown / fence leakage;
 *   - broken Python blocks (a closer directly after a header with no body, or
 *     a dedented body statement that normalization could not repair);
 *   - suspicious indentation jumps (a statement over-indented by 2+ units with
 *     no intermediate block header);
 *   - an obvious language mismatch (conservative heuristic with a high bar).
 *
 * Failure contract (per product spec): on failure we run one deterministic
 * local normalization again, validate once more, and if it still fails we
 * REJECT — the caller must never insert known-broken code.
 */

import {
    createPythonScanner,
    detectIndentUnit,
    normalizePythonLanguage,
    PYTHON_BLOCK_CLOSERS,
    type PythonLineInfo,
} from './languageIndentation';

export interface ValidateResult {
    valid: boolean;
    /** Machine-readable reason for the rejection. */
    reason?: string;
}

// ============================================================================
// Reasoning / markdown leakage
// ============================================================================

const REASONING_LEAK_PATTERNS: RegExp[] = [
    /<\s*think(?:ing)?[\s\S]*?(?:<\s*\/\s*think(?:ing)?>|$)/i,
    /^\s*thinking[ \t]*\n[\s\S]*?\n[ \t]*response[ \t]*\n/i,
    /^self-correction\/[a-z0-9-]+\s*(?:during\s+\w+|[:：]|$).*$/im,
    /^the prompt says.*$/im,
    /^wait,? the prompt says.*$/im,
    /^all constraints? (?:checked|satisfied|verified)[:：]?.*$/im,
    /^reasoning (?:trace|process).*$/im,
    /^internal (?:reasoning|verification|check).*$/im,
    /^chain of thought.*$/im,
    /^the user (?:wants|asked|needs|requested|would like|is asking|is trying|is requesting|is looking for|is expecting)\b.*$/im,
    /^i (?:need to|will|am going to|should|have to)\b.*$/im,
    /^final check\b.*$/im,
    /^let'?s (?:check|review|analyze|look at|verify|see)\b.*$/im,
    /^let me (?:think|check|review|analyze|verify)\b.*$/im,
    /^final answer\s*[:：].*$/im,
    /^(?:here'?s|here is|below is) (?:the |my )?(?:code|result|output|solution|answer|final)\b.*$/im,
];

export const hasReasoningLeak = (code: string): boolean => {
    if (!code) return false;
    // A full-line reasoning preamble counts only when it is NOT valid code for
    // the file; to stay conservative we require a strong marker.
    return REASONING_LEAK_PATTERNS.some((re) => re.test(code));
};

const FENCE_LEAK_RE = /^[ \t]*```/m;

export const hasMarkdownLeak = (code: string): boolean => FENCE_LEAK_RE.test(code);

// ============================================================================
// Python structural validation
// ============================================================================

interface OpenBlock {
    indent: number;
    closers: string[];
    sawBody: boolean;
}

const isCloserFor = (info: PythonLineInfo, block: OpenBlock): boolean =>
    !!info.closerKeyword && block.closers.includes(info.closerKeyword);

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

const validatePythonStructure = (code: string): string | null => {
    const lines = code.split('\n');
    const scanner = createPythonScanner();
    const infos = lines.map((l) => scanner.scanLine(l));
    const unit = detectIndentUnit(infos);
    const stack: OpenBlock[] = [];

    for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (!info.hasCode) continue;

        const indent = info.indent;

        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (indent > top.indent) {
                top.sawBody = true;
                break;
            }
            if (indent === top.indent) {
                if (isCloserFor(info, top)) {
                    // A closer with no body between the header and itself is a
                    // broken block (empty try/if/for/while).
                    if (!top.sawBody) {
                        return `empty block before '${info.closerKeyword}'`;
                    }
                    stack.pop();
                    break;
                }
                if (!info.isBlockHeader && blockWillCloseWithCloser(infos, i + 1, top)) {
                    // Dedented body statement that normalization failed to fix.
                    return 'dedented body statement before block closer';
                }
                if (!top.sawBody && !info.isBlockHeader) {
                    return 'empty block body';
                }
                stack.pop();
                continue;
            }
            // indent < top.indent — the block dedents below its header. A
            // closer dedented below a block it can close, with no outer open
            // block at its own indent, is malformed (a closer must sit at its
            // opener's indentation). Normalization repairs this determinis-
            // tically; if it still appears here, reject.
            if (isCloserFor(info, top)) {
                let acceptAtOwnLevel = false;
                for (let k = stack.length - 1; k >= 0; k--) {
                    if (stack[k].indent < info.indent) break;
                    if (stack[k].indent === info.indent && isCloserFor(info, stack[k])) {
                        acceptAtOwnLevel = true;
                        break;
                    }
                }
                if (!acceptAtOwnLevel) return 'closer dedented below its block';
            }
            stack.pop();
        }

        // Suspicious indentation jump: a statement 2+ units deeper than the
        // innermost block header, with no intermediate header and not a
        // multi-line expression continuation.
        if (stack.length > 0 && info.bracketDepth === 0) {
            const top = stack[stack.length - 1];
            if (info.indent > top.indent + unit * 2 && !info.isBlockHeader) {
                return 'suspicious indentation jump';
            }
        }

        if (info.isBlockHeader) {
            stack.push({
                indent,
                closers: info.keyword ? PYTHON_BLOCK_CLOSERS[info.keyword] ?? [] : [],
                sawBody: false,
            });
        }
    }

    return null;
};

// ============================================================================
// Conservative language-mismatch heuristic
// ============================================================================

const detectLanguageMismatch = (code: string, language?: string | null): string | null => {
    if (!normalizePythonLanguage(language)) return null;
    // Python target but the output is unmistakably a brace/semicolon language.
    const hasDef = /\bdef\s+\w+\s*\(/.test(code);
    const braceLines = (code.match(/^\s*\{[ \t]*$/gm) || []).length;
    const semicolonLines = (code.match(/;\s*$/gm) || []).length;
    const arrowFunctions = (code.match(/=>/g) || []).length;
    if (!hasDef && (braceLines >= 2 || semicolonLines >= 4) && arrowFunctions > 0) {
        return 'language mismatch (output is not Python)';
    }
    return null;
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Validates normalized AI-generated code before editor insertion. The input
 * MUST already have been through `normalizeGeneratedCode`; this is the second
 * half of the canonical pipeline (normalize -> validate -> reject).
 */
export const validateGeneratedCode = (
    code: string,
    options: { language?: string | null } = {},
): ValidateResult => {
    if (!code || code.trim() === '') return { valid: false, reason: 'empty' };

    if (hasReasoningLeak(code)) return { valid: false, reason: 'reasoning leakage' };
    if (hasMarkdownLeak(code)) return { valid: false, reason: 'markdown leakage' };

    if (normalizePythonLanguage(options.language)) {
        const structural = validatePythonStructure(code);
        if (structural) return { valid: false, reason: structural };
        const mismatch = detectLanguageMismatch(code, options.language);
        if (mismatch) return { valid: false, reason: mismatch };
    }

    return { valid: true };
};