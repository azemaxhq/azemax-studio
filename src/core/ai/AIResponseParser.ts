/**
 * AI response parsing & sanitization.
 *
 * - `cleanResponse` — strips reasoning/outer fences from chat display text.
 * - `sanitizeEditorOutput` — STRICT sanitizer for anything inserted into the
 *   editor: guarantees no thinking blocks, reasoning, markdown fences, or
 *   conversational chatter ever reach Monaco.
 * - `parseStructuredEdits` / `applyStructuredEdits` — structured code-edit mode:
 *   prefer `{type:'edit', edits:[{startLine,endLine,replacement}]}`, validate
 *   before applying, and never insert raw model output.
 * - `createVisibleContentFilter` — chunk-safe inline-thinking filter used as a
 *   second line of defense while streaming (the backend already strips it).
 */

const LEADING_THINKING_RE = /^<\s*(?:think(?:ing)?|analysis)/i;
const THINK_BLOCK_RE = /<\s*(?:think(?:ing)?|analysis)[\s\S]*?(?:<\s*\/\s*(?:think(?:ing)?|analysis)\s*>|$)/gi;
const LINE_THINK_BLOCK_RE = /(?:^|\n)<\s*(?:think(?:ing)?|analysis)[\s\S]*?<\s*\/\s*(?:think(?:ing)?|analysis)\s*>/gi;

const CRLF_RE = /\r\n?/g;

const LEADING_WRAPPER_RE = [
    /^here(?:'s| is)?(?: the (?:code|result|output|snippet|(?:modified|fixed|refactored|updated|new|final) code))?[:\s]*$/i,
    /^the (?:code|result|output|snippet)[:\s]*$/i,
    /^(?:modified|fixed|refactored|updated|new|final|generated|resulting) (?:code|output|result|snippet)[:\s]*$/i,
    /^(?:result|output|answer|done)[:\s]*$/i,
    /^sure(?:, here(?:'s| is)?)?[:\s]*$/i,
    /^sure, here is the (?:code|result|output|snippet)[:\s]*$/i,
    /^of course[:\s]*$/i,
    /^ok(?:ay)?[:\s]*$/i,
    // AI meta-commentary / process preambles (rule 6) — bare text lines only.
    /^the user (?:wants|asked|needs|requested|would like|is asking|is trying).*$/i,
    /^this (?:code|function|class|file|program|snippet|script|module)[:\s].*$/i,
    /^here(?:'s| is).*$/i,
    /^(?:as|per) (?:the |your |my )?(?:request|asked|requested|prompt).*$/i,
    /^i(?:'ve| have| will| am|'m).*$/i,
    /^(?:let'?s|we(?:'ll| need| are| have)).*$/i,
];

const TRAILING_WRAPPER_RE = [
    /^done!?$/i,
    /^hope (?:this|that) helps!?$/i,
    /^let me know if (?:you need|you have|you want) .+$/i,
    /^this should (?:work|do it)!?$/i,
    /^feel free to .+$/i,
    /^thanks!?$/i,
    /^happy coding!?$/i,
    /^that(?:'s| is) it!?$/i,
    /^enjoy!?$/i,
    /^the user can now.*$/i,
    /^this (?:code|solution|function) (?:should|will|is now|does what).*$/i,
];

const isWrapperLine = (line: string): boolean =>
    LEADING_WRAPPER_RE.some((re) => re.test(line.trim()));

const isTrailingWrapperLine = (line: string): boolean =>
    TRAILING_WRAPPER_RE.some((re) => re.test(line.trim()));

function unwrapJsonWrapper(text: string): string {
    const t = text.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return text;
    try {
        const parsed = JSON.parse(t);
        if (typeof parsed === 'string') return parsed;
        if (parsed && typeof parsed === 'object') {
            const value =
                parsed.code ?? parsed.result ?? parsed.output ?? parsed.content ?? parsed.text ?? parsed.data;
            if (typeof value === 'string') return value;
        }
    } catch {
        /* not JSON — leave as-is */
    }
    return text;
}

function extractFencedBlock(text: string): string | null {
    const match = text.match(/```(?:[a-zA-Z0-9_+-]*)[^\n]*\n?([\s\S]*?)```/);
    return match ? match[1] : null;
}

/**
 * Whole-line reasoning preambles that must never reach the user. These are the
 * model's internal process notes ("The user wants...", "I need to...",
 * "Let's check...", "Final check..."), not the answer. Only LEADING lines are
 * stripped so legitimate sentences deep in a response are preserved.
 */
const REASONING_PREAMBLE_RE: RegExp[] = [
    /^self-correction\/[a-z0-9-]+\s*(?:during\s+\w+|[:：]|$).*$/i,
    /^self-correction\/refinement during thought.*$/i,
    /^self-correction[:：].*$/i,
    /^the user (?:wants|asked|needs|requested|would like|is asking|is trying|is requesting|is looking for|is expecting)\b.*$/i,
    /^the prompt says.*$/i,
    /^wait,? the prompt says.*$/i,
    /^all constraints? (?:checked|satisfied|verified|met)[:：]?.*$/i,
    /^i (?:need to|will|am going to|should|have to)\b.*$/i,
    /^let'?s (?:check|review|analyze|look at|verify|see)\b.*$/i,
    /^final check\b.*$/i,
    /^let me (?:think|check|review|analyze|verify)\b.*$/i,
    /^(?:my|the) (?:approach|plan|strategy|reasoning|thought)\s*[:：].*$/i,
    /^(?:note|notes)\s*[:：].*$/i,
    /^reasoning (?:trace|process).*$/i,
    /^internal (?:reasoning|verification|check).*$/i,
    /^chain of thought.*$/i,
    /^output matches response.*$/i,
    /^all constraints met.*$/i,
    /^proceed\.?$/i,
    /^\[done\]$/i,
    /^here is the comment:?\s*$/i,
    /^here'?s the comment:?\s*$/i,
    /^the comment:?\s*$/i,
    /^sure,? here'?s:?\s*$/i,
    /^sure,? here is the comment:?\s*$/i,
    /^ok,? here'?s:?\s*$/i,
    /^as requested:?\s*$/i,
    /^per your request:?\s*$/i,
    /^(?:\[|\().*?\]?\s*(?:thinking|reasoning|thought)[\s\S]*$/i,
];

function stripLeadingReasoningLines(text: string): string {
    const lines = text.split('\n');
    while (lines.length > 0 && REASONING_PREAMBLE_RE.some((re) => re.test(lines[0].trim()))) {
        lines.shift();
    }
    // A "Result:" prefix token is meta-voice; drop the token but keep the answer
    // after it ("Result: 42" -> "42").
    if (lines.length > 0) {
        lines[0] = lines[0].replace(/^[ \t]*result\s*[:：]/i, '');
    }
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    return lines.join('\n');
}

export { stripLeadingReasoningLines };

/**
 * STRIP ALL REASONING from a full response (non-streamed path). Runs as the
 * last stage of the centralized output-safety pipeline before any consumer sees
 * the text. Handles every reasoning shape:
 *   - Qwen-style `\n thinking\n ... \n response\n` (closed and trailing-unclosed)
 *   - XML-style `<thinking> ... </thinking>` (closed and trailing-unclosed)
 *   - leading reasoning-preamble lines ("The user wants...", "I need to...")
 * Returns '' when the response contained nothing but reasoning.
 */
export const stripAllReasoning = (content: string): string => {
    if (!content) return '';
    let cleaned = content;

    cleaned = stripInlineThinking(cleaned);

    // XML-style thinking blocks. The `(?:...|$)` alternative also drops an
    // unterminated trailing block so `\n<thinking>...` at the very end never
    // leaks.
    cleaned = cleaned.replace(THINK_BLOCK_RE, '');

    cleaned = stripLeadingReasoningLines(cleaned);

    return cleaned.trim();
};

/**
 * Aggressively strip reasoning patterns from ANYWHERE in the content.
 * Used for defense-in-depth in comment mode where reasoning may be embedded
 * within the comment text itself.
 */
export const stripReasoningAnywhere = (content: string): string => {
    if (!content) return '';
    let cleaned = content;

    cleaned = stripInlineThinking(cleaned);
    cleaned = cleaned.replace(THINK_BLOCK_RE, '');

    // Strip reasoning preamble patterns from anywhere in the content
    const lines = cleaned.split('\n');
    const filtered = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true; // keep empty lines
        return !REASONING_PREAMBLE_RE.some((re) => re.test(trimmed));
    });

    return filtered.join('\n').trim();
};

export const cleanResponse = (content: string): string => {
    let cleaned = stripAllReasoning(content);

    const codeBlockMatch = cleaned.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[2];
    } else {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim();
};

/**
 * Strips reasoning_content from chat response messages (non-streaming).
 * This is called on the final response content from the provider.
 */
export const stripReasoningFromResponse = (content: string): string => {
    // The reasoning_content should already be stripped at the provider level,
    // but this is a safety net in case it leaks through
    return stripAllReasoning(content);
};

/**
 * Removes Qwen-style inline-thinking blocks (`\n thinking\n ... \n response\n`)
 * from FULL text (the streamed chunks are already filtered chunk-by-chunk by
 * `createVisibleContentFilter`; this catches non-streamed responses and split
 * blocks that reached the final response). A leading `thinking` block with no
 * closer is also dropped, since a source file can never validly start with a
 * bare `thinking` line. Code containing the words "thinking"/"response" inside
 * strings or identifiers is preserved.
 */
const INLINE_THINK_CLOSED_RE = /\n[ \t]*(?:thinking|analysis)[ \t]*\n[\s\S]*?\n[ \t]*response[ \t]*\n/g;
const INLINE_THINK_LEADING_RE = /^\s*(?:thinking|analysis)[ \t]*\n[\s\S]*?(?:\n[ \t]*response[ \t]*\n|$)/;

export const stripInlineThinking = (text: string): string => {
    let t = text.replace(INLINE_THINK_CLOSED_RE, '\n');
    if (INLINE_THINK_LEADING_RE.test(t)) {
        t = t.replace(INLINE_THINK_LEADING_RE, '');
    }
    return t;
};

/**
 * STRICT editor sanitizer. Returns ONLY the code that belongs in the file:
 * strips reasoning/thinking blocks, JSON/text wrappers, fenced blocks, and
 * leading/trailing conversational lines. Conservative: real code, comments,
 * and code strings (e.g. a string containing " thinking") are preserved.
 */
export const sanitizeEditorOutput = (raw: string): string => {
    if (!raw) return '';

    // Normalize line endings first so CRLF/CR never reach Monaco.
    let out = raw.replace(CRLF_RE, '\n').trim();

    if (LEADING_THINKING_RE.test(out)) {
        out = out.replace(THINK_BLOCK_RE, '').trimStart();
    }
    out = out.replace(LINE_THINK_BLOCK_RE, '\n').trim();

    // Qwen-style inline thinking (split-safe on the full response).
    out = stripInlineThinking(out).trim();

    out = unwrapJsonWrapper(out).trim();

    const fenced = extractFencedBlock(out);
    if (fenced !== null) {
        return fenced.trim();
    }

    const lines = out.split('\n');
    while (lines.length > 0 && isWrapperLine(lines[0])) {
        lines.shift();
    }
    while (lines.length > 0 && isTrailingWrapperLine(lines[lines.length - 1])) {
        lines.pop();
    }
    out = lines.join('\n');

    out = out.replace(/^```[^\n]*\n?/gm, '').replace(/```/g, '');

    return out.trim();
};

// ============================================================================
// Structured code edits
// ============================================================================

export interface StructuredEdit {
    startLine: number;
    endLine: number;
    replacement: string;
}

export interface StructuredEditResult {
    type: 'edit';
    edits: StructuredEdit[];
}

/**
 * Parses a structured edit payload from a model response.
 * Tolerates reasoning blocks / fences / wrapper text around the JSON. Returns
 * null when the payload is not a valid edit object (caller falls back to a
 * full-file replacement).
 */
export const parseStructuredEdits = (raw: string): StructuredEditResult | null => {
    if (!raw) return null;

    let candidate = raw.trim();
    const fenced = extractFencedBlock(candidate);
    if (fenced !== null) candidate = fenced.trim();
    candidate = candidate.replace(LINE_THINK_BLOCK_RE, '\n').trim();

    const match = candidate.match(/(\{[\s\S]*\})/);
    if (!match) return null;

    try {
        const parsed = JSON.parse(match[1]);
        if (!parsed || parsed.type !== 'edit' || !Array.isArray(parsed.edits)) return null;
        const edits = parsed.edits
            .filter(
                (e: unknown) =>
                    typeof e === 'object' &&
                    e !== null &&
                    typeof (e as StructuredEdit).startLine === 'number' &&
                    typeof (e as StructuredEdit).endLine === 'number' &&
                    typeof (e as StructuredEdit).replacement === 'string',
            )
            .map((e: StructuredEdit) => ({
                startLine: Math.max(1, Math.floor(e.startLine)),
                endLine: Math.max(1, Math.floor(e.endLine)),
                replacement: e.replacement,
            }));
        if (edits.length === 0) return null;
        return { type: 'edit', edits };
    } catch {
        return null;
    }
};

/**
 * Tracks multi-line string state (triple quotes, backticks, heredocs) while
 * walking lines, so a uniform leading-whitespace shift never rewrites text
 * inside strings/comments.
 */
interface StringState {
    triple: string | null;
    backtick: boolean;
    heredoc: boolean;
    blockComment: boolean;
}

const BLOCK_COMMENT_OPEN = '/*';
const BLOCK_COMMENT_CLOSE = '*/';

const advanceStringState = (state: StringState, line: string): StringState => {
    let { triple, backtick, heredoc, blockComment } = state;
    let i = 0;
    const n = line.length;
    while (i < n) {
        if (blockComment) {
            const close = line.indexOf(BLOCK_COMMENT_CLOSE, i);
            if (close === -1) return { triple, backtick, heredoc, blockComment };
            blockComment = false;
            i = close + 2;
            continue;
        }
        if (triple) {
            const close = line.indexOf(triple, i);
            if (close === -1) return { triple, backtick, heredoc, blockComment };
            triple = null;
            i = close + 3;
            continue;
        }
        if (backtick) {
            const close = line.indexOf('`', i);
            if (close === -1) return { triple, backtick, heredoc, blockComment };
            backtick = false;
            i = close + 1;
            continue;
        }
        if (heredoc) {
            // Heredocs terminate at a line consisting only of the delimiter;
            // best-effort: terminate on the next line that is not indented.
            return { triple, backtick, heredoc: false, blockComment };
        }
        if (line.startsWith(BLOCK_COMMENT_OPEN, i)) {
            blockComment = true;
            i += 2;
            continue;
        }
        if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
            triple = line.startsWith('"""', i) ? '"""' : "'''";
            i += 3;
            continue;
        }
        if (line[i] === '`') {
            backtick = true;
            i += 1;
            continue;
        }
        // Shell/Python heredoc opener: `<<EOF`, `<<< "..."` or `<<'EOF'`.
        if (line[i] === '<' && line[i + 1] === '<') {
            heredoc = true;
            i += 2;
            continue;
        }
        i++;
    }
    return { triple, backtick, heredoc, blockComment };
};

/**
 * Shifts the leading whitespace of every line in `replacement` by `delta`
 * columns (may be negative, clamped to 0), WITHOUT altering lines inside
 * multi-line strings, backticks, heredocs, or block comments. Blank lines are
 * left untouched. This preserves the replacement's internal relative
 * indentation while aligning it to a target line.
 */
export const shiftReplacementIndent = (replacement: string, delta: number): string => {
    if (delta === 0) return replacement;
    const lines = replacement.split('\n');
    let state: StringState = { triple: null, backtick: false, heredoc: false, blockComment: false };
    const out = lines.map((line) => {
        // A line is string CONTENT only if it starts while a multi-line
        // construct is already open. Exception: a line that consists solely of
        // the construct's closing delimiter (leading whitespace + delimiter) is
        // code-level indentation and shifts with the surrounding code.
        const startsInside = state.blockComment || state.triple !== null || state.backtick || state.heredoc;
        const next = advanceStringState(state, line);
        const closesHere = startsInside && !(next.blockComment || next.triple !== null || next.backtick || next.heredoc);
        const delimitersOnly = closesHere && /^\s*(?:"""|'''|`|\*\/)$/.test(line);
        let result = line;
        if (line.trim() !== '' && (!startsInside || delimitersOnly)) {
            const leading = line.match(/^[ \t]*/)?.[0] ?? '';
            const newLen = Math.max(0, leading.length + delta);
            result = ' '.repeat(newLen) + line.slice(leading.length);
        }
        state = next;
        return result;
    });
    return out.join('\n');
};

/**
 * Applies validated structured edits to `code`. Line numbers are 1-based and
 * clamped to the document; edits are applied top-down. Returns null when any
 * edit is out of range (caller should not modify the editor).
 *
 * Indentation: a multi-line replacement is aligned to the target line's
 * leading whitespace so the FIRST content line matches the target indent and
 * the replacement's internal relative indentation is preserved. Lines inside
 * multi-line strings/heredocs/template literals are never re-indented.
 */
export const applyStructuredEdits = (code: string, edits: StructuredEdit[]): string | null => {
    const lines = code.split('\n');
    if (edits.length === 0) return null;

    // Sort descending by startLine so earlier edits don't shift later line numbers.
    // This is critical for comment operations that insert above multiple lines —
    // applying bottom-up keeps original line numbers valid.
    const sorted = [...edits].sort((a, b) => b.startLine - a.startLine || b.endLine - a.endLine);

    // Deduplicate edits with identical range to prevent duplicate insertion
    const seen = new Set<string>();
    const deduped: StructuredEdit[] = [];
    for (const e of sorted) {
        const key = `${e.startLine}:${e.endLine}`;
        if (seen.has(key)) {
            console.warn('[applyStructuredEdits] Duplicate edit range skipped', e);
            continue;
        }
        seen.add(key);
        deduped.push(e);
    }

    let result: string[] = [...lines];
    for (const edit of deduped) {
        if (edit.startLine > edit.endLine) return null;
        if (edit.startLine < 1 || edit.endLine > lines.length) {
            // For insertion at file start we allow endLine === 0 (insert before line 1)
            // as a special case used by some comment prompts.
            if (!(edit.startLine === 1 && edit.endLine === 0)) return null;
        }

        // Handle pure insertion (endLine === 0): insert before startLine
        if (edit.endLine === 0) {
            const targetLine = lines[edit.startLine - 1] ?? '';
            const targetIndent = targetLine.match(/^[ \t]*/)?.[0] ?? '';
            let replacement = edit.replacement;
            const firstIdx = replacement.split('\n').findIndex(l => l.trim() !== '');
            if (firstIdx !== -1) {
                const firstIndent = replacement.split('\n')[firstIdx].match(/^[ \t]*/)?.[0] ?? '';
                replacement = shiftReplacementIndent(replacement, targetIndent.length - firstIndent.length);
            }
            result = [
                ...result.slice(0, edit.startLine - 1),
                ...replacement.split('\n'),
                ...result.slice(edit.startLine - 1),
            ];
            continue;
        }

        const targetLine = lines[edit.startLine - 1] ?? '';
        const targetIndent = targetLine.match(/^[ \t]*/)?.[0] ?? '';
        const replacementLines = edit.replacement.split('\n');
        const firstContentIndex = replacementLines.findIndex((l) => l.trim() !== '');
        let replacement = edit.replacement;
        if (firstContentIndex !== -1) {
            const firstIndent = replacementLines[firstContentIndex].match(/^[ \t]*/)?.[0] ?? '';
            replacement = shiftReplacementIndent(replacement, targetIndent.length - firstIndent.length);
        }

        result = [
            ...result.slice(0, edit.startLine - 1),
            ...replacement.split('\n'),
            ...result.slice(edit.endLine),
        ];
    }
    return result.join('\n');
};

// ============================================================================
// Chunk-safe inline-thinking filter (defense in depth while streaming)
// ============================================================================

/**
 * Leading reasoning-preamble suppression (defensive secondary layer).
 *
 * Some backends can put reasoning text into the `content` channel WITHOUT
 * `reasoning_content` and WITHOUT thinking markers, e.g.:
 *
 *   "Self-Correction/Refinement during thought:
 *    The prompt says...
 *    Wait, the prompt says...
 *    All constraints checked...
 *    Hello! How can I help you?"
 *
 * The provider-native `reasoning_content` field is the authoritative separation
 * (mapped to `reasoning` events and dropped in the stream filter). This
 * suppressor is the second line of defense: while the visible stream is still
 * at its START, whole lines that look like internal-reasoning narration are
 * discarded. TTFB for real content is preserved — a line that is not a
 * reasoning-preamble prefix is flushed immediately.
 */

const LEADING_REASONING_PREFIXES = [
    'self-correction',
    'the prompt says',
    'wait, the prompt says',
    'all constraints',
    'final check',
    'let me ',
    "let's ",
    'lets ',
    'i need to',
    'i will',
    'i am going to',
    'i should',
    'i have to',
    'my approach',
    'my plan',
    'my strategy',
    'my reasoning',
    'my thought',
    'the approach',
    'the plan',
    'the strategy',
    'the reasoning',
    'the thought',
    'note:',
    'notes:',
    'result:',
    'reasoning trace',
    'reasoning process',
    'internal reasoning',
    'internal verification',
    'internal check',
    'chain of thought',
    'system prompt',
    'developer instructions',
    'the user wants',
    'the user asked',
    'the user needs',
    'the user requested',
    'the user would like',
    'the user is asking',
    'the user is trying',
    'the user is requesting',
];

const MAX_LEAD_HOLD = 1024;

const isReasoningPreambleLine = (line: string): boolean => {
    const t = line.trim();
    return t !== '' && REASONING_PREAMBLE_RE.some((re) => re.test(t));
};

const isPossiblePreamblePrefix = (text: string): boolean => {
    const t = text.trimStart().toLowerCase();
    if (t === '') return false;
    return LEADING_REASONING_PREFIXES.some((p) => p.startsWith(t) && t.length < p.length);
};

export const createLeadingPreambleSuppressor = () => {
    let done = false;
    let justDropped = false; // last discarded line was a reasoning preamble
    let buf = '';
    let out = '';

    return {
        /** Feed visible text; returns the text safe to emit ('' while holding). */
        feed(chunk: string): string {
            if (done) return chunk;
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                const t = line.trim();
                if (t === '') {
                    // Blank line: skip it when it directly follows a dropped
                    // reasoning preamble; otherwise pass it through untouched.
                    if (!justDropped) out += '\n';
                    continue;
                }
                if (isReasoningPreambleLine(line)) {
                    justDropped = true; // internal narration: drop
                    continue;
                }
                done = true;
                out += line + '\n' + buf;
                buf = '';
                return out;
            }
            if (buf.length > MAX_LEAD_HOLD) {
                done = true;
                out += buf;
                buf = '';
                return out;
            }
            if (isReasoningPreambleLine(buf)) {
                buf = '';
                justDropped = true;
                return out;
            }
            if (isPossiblePreamblePrefix(buf)) return out; // keep holding
            // Only mark as done if we have actual content (not just reasoning preambles)
            if (!justDropped) {
                done = true;
            }
            out += buf;
            buf = '';
            return out;
        },
        /** Flush remaining held text at stream end. Reasoning-only tail is dropped. */
        end(): string {
            if (done) return buf;
            if (buf !== '' && (isReasoningPreambleLine(buf) || isPossiblePreamblePrefix(buf))) {
                return '';
            }
            if (buf.trim() !== '') {
                done = true;
                const rest = buf;
                buf = '';
                return rest;
            }
            return '';
        },
    };
};

/**
 * Mirrors the backend's `createVisibleContentFilter`: suppresses inline
 *  thinking... response  and <thinking>...</thinking> blocks even when split
 * across arbitrary chunk boundaries, plus leading reasoning preambles leaked
 * into the content channel. Unclosed thinking at end-of-stream is dropped (it
 * is reasoning and must never be displayed); partial-tail holds of NORMAL
 * content (e.g. trailing "... think" that never formed a block) are released so
 * legitimate content is never swallowed.
 */
export function createVisibleContentFilter() {
    const OPEN = ['\n thinking', '\n analysis', '<think', '<analysis'];
    const CLOSE_XML = ['\n response', '</think', '</analysis'];
    const CLOSE_QWEN = ['\n response', '</think', '</analysis'];
    const TAIL = 32;
    const MAX_THINK_HOLD = 4096;

    let normalBuf = '';
    let held = '';
    let inThinking = false;
    let xmlStyle = false;
    const leadingSuppressor = createLeadingPreambleSuppressor();

    const findAny = (text: string, markers: string[]): { index: number; marker: string } | null => {
        let bestIndex = -1;
        let bestMarker = '';
        for (const m of markers) {
            const i = text.indexOf(m);
            if (i !== -1 && (bestIndex === -1 || i < bestIndex)) {
                bestIndex = i;
                bestMarker = m;
            }
        }
        return bestIndex === -1 ? null : { index: bestIndex, marker: bestMarker };
    };

    const partialTailLen = (text: string, markers: string[]) => {
        let maxLen = 0;
        for (const m of markers) {
            for (let l = 1; l < m.length; l++) {
                if (text.endsWith(m.slice(0, l))) maxLen = Math.max(maxLen, l);
            }
        }
        return maxLen;
    };

    const process = () => {
        let out = '';
        for (;;) {
            if (inThinking) {
                if (held.length > MAX_THINK_HOLD) held = held.slice(held.length - TAIL);
                const hit = findAny(held, xmlStyle ? CLOSE_XML : CLOSE_QWEN);
                if (!hit) break;
                let rest = held.slice(hit.index + hit.marker.length);
                if (hit.marker === '</think') {
                    // `</think` matched a `</thinking>` (or `</thinkinging>`)
                    // closer — consume the trailing "ing" so no fragment leaks.
                    while (rest.startsWith('ing')) rest = rest.slice(3);
                    if (rest.startsWith('>')) rest = rest.slice(1);
                }
                inThinking = false;
                normalBuf = rest;
                held = '';
                continue;
            }

            const hit = findAny(normalBuf, OPEN);
            if (!hit) {
                const keep = partialTailLen(normalBuf, OPEN);
                const safeLen = Math.max(0, normalBuf.length - keep);
                out += normalBuf.slice(0, safeLen);
                normalBuf = normalBuf.slice(safeLen);
                break;
            }
            out += normalBuf.slice(0, hit.index);
            normalBuf = normalBuf.slice(hit.index + hit.marker.length);
            xmlStyle = hit.marker === '<think';
            inThinking = true;
            held = normalBuf;
            normalBuf = '';
        }
        return out;
    };

    return {
        push(chunk: string): string {
            if (inThinking) held += chunk;
            else normalBuf += chunk;
            return leadingSuppressor.feed(process());
        },
        end(): string {
            // Unclosed thinking is reasoning: drop it. Normal (possibly
            // partial-tail) content is released.
            const out = inThinking ? '' : normalBuf;
            held = '';
            normalBuf = '';
            inThinking = false;
            xmlStyle = false;
            return leadingSuppressor.feed(out) + leadingSuppressor.end();
        },
};
}
