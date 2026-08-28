/**
 * Language-aware indentation metadata for the AI runtime.
 *
 * Single source of truth for:
 *   - which languages treat indentation as semantically significant (Python,
 *     YAML) vs. cosmetic (brace-based languages);
 *   - the default indentation unit per language;
 *   - Python block structure: header keywords, which keywords close which
 *     block, and a lightweight single-pass scanner that classifies every line
 *     (indent, keyword, block-header, closer) while never mistaking strings,
 *     comments, or triple-quoted text for code.
 *
 * The scanner is deliberately lightweight (O(n), no tokenizer, no full parser)
 * so validation and normalization stay effectively free.
 */

export const PYTHON_HEADER_KEYWORDS = new Set([
    'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally',
    'def', 'class', 'with', 'match', 'case',
]);

export const PYTHON_CLOSER_KEYWORDS = new Set(['elif', 'else', 'except', 'finally']);

/**
 * Keywords that close each block header. A line whose first keyword is in the
 * set at the SAME indent as the block's header terminates that block.
 *   try  -> except / else / finally
 *   if   -> elif / else
 *   for  -> else
 *   while-> else
 *   etc.
 */
export const PYTHON_BLOCK_CLOSERS: Record<string, string[]> = {
    if: ['elif', 'else'],
    elif: ['elif', 'else'],
    for: ['else'],
    while: ['else'],
    try: ['except', 'else', 'finally'],
    except: ['except', 'else', 'finally'],
    else: ['finally'],
    def: [],
    class: [],
    with: [],
    match: [],
    case: [],
    finally: [],
};

export interface PythonLineInfo {
    /** Leading whitespace width (tab = 4 columns). */
    indent: number;
    /** True when the line carries code outside strings/comments. */
    hasCode: boolean;
    /** True when the line is entirely blank (or comment-only). */
    isBlank: boolean;
    /** First significant identifier, e.g. 'if', 'except', 'print'. 'async def' -> 'def'. */
    keyword: string | null;
    /** True when the line is a block header (ends with ':' outside strings). */
    isBlockHeader: boolean;
    /** Non-null when the line is a closer at a block boundary ('elif'/'else'/'except'/'finally'). */
    closerKeyword: string | null;
    /** Unclosed bracket depth after this line (continuations are not headers). */
    bracketDepth: number;
}

export const pythonIndentWidth = (line: string): number => {
    let w = 0;
    for (const ch of line) {
        if (ch === ' ') w += 1;
        else if (ch === '\t') w += 4;
        else break;
    }
    return w;
};

/**
 * Single-pass Python line scanner. Holds string/triple-quote/bracket state
 * across lines so a header inside a docstring or a `:` inside a string is
 * never mistaken for code.
 */
export function createPythonScanner() {
    let triple: string | null = null;
    let quote: string | null = null;
    let bracketDepth = 0;

    const scanLine = (line: string): PythonLineInfo => {
        const info: PythonLineInfo = {
            indent: pythonIndentWidth(line),
            hasCode: false,
            isBlank: line.trim() === '',
            keyword: null,
            isBlockHeader: false,
            closerKeyword: null,
            bracketDepth: 0,
        };

        let sig = '';
        let i = 0;
        const n = line.length;
        while (i < n) {
            const ch = line[i];
            if (triple) {
                if (line.startsWith(triple, i)) {
                    i += 3;
                    triple = null;
                    continue;
                }
                i++;
                continue;
            }
            if (quote) {
                if (ch === '\\') {
                    i += 2;
                    continue;
                }
                if (ch === quote) quote = null;
                i++;
                continue;
            }
            if (ch === '#') break;
            if (ch === '"' || ch === "'") {
                if (line.startsWith(ch + ch + ch, i)) {
                    triple = ch + ch + ch;
                    i += 3;
                    continue;
                }
                quote = ch;
                i++;
                continue;
            }
            if (ch === '(' || ch === '[' || ch === '{') {
                bracketDepth++;
                sig += ch;
                i++;
                continue;
            }
            if (ch === ')' || ch === ']' || ch === '}') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                sig += ch;
                i++;
                continue;
            }
            sig += ch;
            i++;
        }

        info.bracketDepth = bracketDepth;
        info.hasCode = sig.trim() !== '';
        if (!info.hasCode) return info;

        const trimmed = sig.trim();
        const first = trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*/);
        let keyword = first ? first[0] : null;
        if (keyword === 'async') {
            const next = trimmed.match(/^async[ \t]+([A-Za-z_][A-Za-z0-9_]*)/);
            keyword = next ? next[1] : 'async';
        }
        info.keyword = keyword;

        const endsColon = info.bracketDepth === 0 && trimmed.endsWith(':');
        info.isBlockHeader = endsColon && !!keyword && PYTHON_HEADER_KEYWORDS.has(keyword);
        info.closerKeyword =
            endsColon && !!keyword && PYTHON_CLOSER_KEYWORDS.has(keyword) ? keyword : null;
        return info;
    };

    return { scanLine };
}

/**
 * Detects the indentation unit (most likely body increment) from a scanned
 * file. Uses the smallest positive difference between distinct indent levels
 * within a sane 2..8 range, falling back to 4.
 */
export const detectIndentUnit = (infos: PythonLineInfo[]): number => {
    const levels = new Set<number>();
    for (const info of infos) {
        if (!info.hasCode) continue;
        if (info.indent > 0) levels.add(info.indent);
    }
    const sorted = [...levels].sort((a, b) => a - b);
    let unit = 4;
    for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i] - sorted[i - 1];
        if (d >= 2 && d <= 8) {
            unit = Math.min(unit, d);
        }
    }
    return unit;
};

export const normalizePythonLanguage = (language?: string | null): boolean => {
    if (!language) return false;
    return /^py(thon)?$/i.test(language.trim().toLowerCase().replace(/^\./, ''));
};