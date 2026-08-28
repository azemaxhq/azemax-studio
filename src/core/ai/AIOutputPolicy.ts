/**
 * Language-aware output policy for the AI runtime.
 *
 * Single enforcement point for everything that can reach the editor. The policy
 * decides whether generated comments are even allowed for a given task, strips
 * model reasoning / meta-commentary before insertion, and validates comment
 * syntax against the file's actual language.
 *
 * Modes:
 *   generate / autocomplete / edit / refactor / fix / explain  -> NO new comments
 *   comment / document                                          -> comments allowed
 *
 * `sanitizeEditorOutput` (base) removes reasoning, fences and wrapper lines for
 * every path. This policy layer additionally:
 *   - strips AI meta-commentary lines (e.g. "The user wants...", "Here is the
 *     code...") while PRESERVING any comment that already existed in `preserve`;
 *   - for comment/document modes, removes lines whose comment syntax is invalid
 *     for the detected language (e.g. `//` in Python).
 */

import { sanitizeEditorOutput as baseSanitizeEditorOutput, stripLeadingReasoningLines, stripReasoningAnywhere } from './AIResponseParser';
import { normalizeGeneratedCode } from './AICodeNormalizer';
import { validateGeneratedCode } from './AICodeValidator';
import { getCommentSyntax, applyCommentSyntax } from './commentSyntax';

export { getCommentSyntax, applyCommentSyntax } from './commentSyntax';

export type OutputMode =
    | 'generate'
    | 'autocomplete'
    | 'edit'
    | 'refactor'
    | 'fix'
    | 'explain'
    | 'comment'
    | 'document';

export interface AIOutputPolicyInput {
    task?: string;
    language?: string;
    filename?: string;
    userInstruction?: string;
    outputMode?: OutputMode;
    /** Original file/snippet content — comments already present are never stripped. */
    preserve?: string;
}

// ============================================================================
// Language detection
// ============================================================================

const EXT_LANGUAGE: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
    cs: 'csharp',
    go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', kts: 'kotlin',
    css: 'css', scss: 'scss', sass: 'scss', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte',
    json: 'json', jsonc: 'json',
    sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'shell',
    sql: 'sql', lua: 'lua',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', conf: 'ini', cfg: 'ini',
    md: 'markdown', mdx: 'markdown',
    tf: 'terraform', hcl: 'terraform',
    txt: 'text',
};

export const resolveLanguageFromFilename = (filename?: string | null): string | null => {
    if (!filename) return null;
    const base = filename.split(/[\\/]/).pop() || filename;
    const lower = base.toLowerCase();
    if (lower === 'dockerfile' || lower === 'makefile' || lower === 'cmakelists.txt') return 'text';
    const ext = base.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    return EXT_LANGUAGE[ext] || null;
};

// ============================================================================
// Comment syntax per language — delegates to canonical commentSyntax module
// ============================================================================

/** Wrapper around canonical CommentSyntax for backward compatibility. */
interface CommentSyntax {
    line?: string[];
    block?: [string, string];
    doc?: string[];
}

function toLegacySyntax(canonical: ReturnType<typeof getCommentSyntax> | null): CommentSyntax | null {
    if (!canonical || !canonical.supported) return null;
    const out: CommentSyntax = {};
    if (canonical.line) out.line = [canonical.line, ...(canonical.lineAlt || [])];
    if (canonical.blockStart && canonical.blockEnd) out.block = [canonical.blockStart, canonical.blockEnd];
    // doc comments: for python triple-quote, csharp ///, etc.
    if (canonical.line === '#' && canonical.blockStart === '"""') out.doc = ['"""', "'''"];
    if (canonical.line === '//' && canonical.lineAlt?.includes('///')) out.doc = ['///'];
    return out;
}

export const commentSyntaxFor = (language?: string | null): CommentSyntax | null => {
    return toLegacySyntax(getCommentSyntax(language));
};

/** All recognized comment markers (canonical + legacy). */
const KNOWN_MARKERS = ['<!--', '/*', '//', '--', '#', ';', '%', '///', '*/', '-->', '---'];

// ============================================================================
// Intent detection
// ============================================================================

const COMMENT_INTENT_RE =
    /\b(comment|comments|commenting)\b|\b(add|with|write|put|insert|include)\s+(comments?|docstrings?|annotations?|notes?)\b|add comments|comment (this|out|the|this function|this class)/i;

const DOCUMENT_INTENT_RE =
    /\b(document|documentation|docstrings?|xml\s*doc(?:umentation)?|javadoc|summary\s*comment|\\\/\\\/\\\/\s*<summary>)\b/i;

export const isCommentingIntent = (instruction?: string | null): boolean => {
    if (!instruction) return false;
    return COMMENT_INTENT_RE.test(instruction);
};

export const isDocumentingIntent = (instruction?: string | null): boolean => {
    if (!instruction) return false;
    return DOCUMENT_INTENT_RE.test(instruction);
};

// ============================================================================
// AI meta-commentary detection (rule 6: "The user wants...", "This code...",
// "Here is...", etc.). These are AI/process explanations that must never reach
// the editor. `preserve` protects comments that already existed in the file.
// ============================================================================

// AI PROCESS voice — references the user/request/task directly. These are
// wrong in ANY mode (including comment/document), so they are always stripped.
const AI_PROCESS_COMMENT_PATTERNS: RegExp[] = [
    /\bthe user (?:wants|asked|needs|requested|would like|is asking|is trying|is looking for|is requesting)\b/i,
    /\bthe (?:user|request|prompt|task) (?:was|is) to\b/i,
    /\b(?:here'?s|here is) (?:the |my )?(?:code|result|output|final|updated|corrected|fixed|refactored|answer|solution)\b/i,
    /\b(?:as|per) (?:the |your |my )?(?:request|asked|requested|prompt)\b/i,
    /^(?:i'?ve|i have|i will|i am|i'm|let'?s|we'?ll|we need|we are|we have|below is|the following is)\b/i,
    /\bthis (?:code|file|function|class|method|script|snippet) (?:implements|handles|fulfills|satisfies|addresses|solves|fixes) (?:the|your|this) (?:request|task|prompt|requirement|problem|issue)\b/i,
    /\bthis (?:implements|handles|satisfies|addresses|solves|fixes) (?:the|your|this) (?:request|task|prompt|requirement|problem|issue)\b/i,
    /\b(?:no|without) (?:explanation|reasoning|comments?)\b/i,
];

// AI CONTENT commentary — describes what the code "is/does". Legitimate when
// the user explicitly asked for comments (comment/document), forbidden for
// every other task (generate/autocomplete/edit/refactor/fix).
const AI_CONTENT_COMMENT_PATTERNS: RegExp[] = [
    /\b(?:the|this) (?:code|file|function|class|method|script) (?:is|contains|shows|demonstrates|illustrates|was written to|returns|takes|calculates|computes|finds|creates|adds|removes|prints|renders|handles|initializes|checks)\b/i,
    /\bthis (?:will|should|would|does|is going to)\b/i,
    /\bthis (?:is a|is my|is an)\b/i,
];

export const isAiMetaCommentary = (line: string, commentMode = false): boolean => {
    const body = line.trim();
    if (!body) return false;
    if (AI_PROCESS_COMMENT_PATTERNS.some((re) => re.test(body))) return true;
    if (!commentMode && AI_CONTENT_COMMENT_PATTERNS.some((re) => re.test(body))) return true;
    return false;
};

const META_COMMENT_STARTER_RE = /^(?:[ \t]*)(?:\/\/|#|--|<!--|;|%)\s?/;

/**
 * Removes AI-generated meta-commentary lines (only those that START as a
 * comment) while preserving any comment already present in `preserve`.
 * Real code, strings, and non-comment lines are never touched. In
 * `commentMode` only AI process-voice lines are removed, so legitimate content
 * comments ("This function returns the sum") survive an explicit comment task.
 */
export const stripAiMetaCommentary = (content: string, preserve?: string, commentMode = false): string => {
    if (!content) return content;
    const preserved = new Set<string>();
    if (preserve) {
        for (const line of preserve.split('\n')) {
            const t = line.trim();
            if (t) preserved.add(t);
        }
    }
    return content
        .split('\n')
        .map((line) => {
            if (!META_COMMENT_STARTER_RE.test(line)) return line;
            if (preserved.has(line.trim())) return line;
            return isAiMetaCommentary(line, commentMode) ? '' : line;
        })
        .join('\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
};

// ============================================================================
// Comment-syntax validation
// ============================================================================

/**
 * True when every comment line in `content` starts with a marker valid for
 * `language`. Lines that don't start with a known comment marker are ignored
 * (they are code).
 */
export const validateCommentSyntax = (content: string, language?: string | null): boolean => {
    const syntax = commentSyntaxFor(language);
    if (!syntax) return true;
    const valid = new Set<string>(syntax.line || []);
    if (syntax.block) valid.add(syntax.block[0]);
    if (syntax.doc) for (const m of syntax.doc) valid.add(m);

    for (const line of content.split('\n')) {
        const t = line.trimStart();
        if (!t) continue;
        for (const marker of KNOWN_MARKERS) {
            if (t.startsWith(marker)) {
                if (!valid.has(marker)) return false;
                break;
            }
        }
    }
    return true;
};

/**
 * Removes comment lines whose marker is invalid for the detected language
 * (e.g. a `//` comment in Python). Only whole comment lines are removed —
 * code is never altered.
 */
export const stripInvalidCommentSyntax = (content: string, language?: string | null): string => {
    const syntax = commentSyntaxFor(language);
    if (!syntax) return content;
    const valid = new Set<string>(syntax.line || []);
    if (syntax.block) valid.add(syntax.block[0]);
    if (syntax.doc) for (const m of syntax.doc) valid.add(m);

    return content
        .split('\n')
        .filter((line) => {
            const t = line.trimStart();
            if (!t) return true;
            for (const marker of KNOWN_MARKERS) {
                if (t.startsWith(marker)) return valid.has(marker);
            }
            return true;
        })
        .join('\n');
};

// ============================================================================
// Mode resolution + policy sanitizer
// ============================================================================

export const resolveOutputMode = (input: AIOutputPolicyInput): OutputMode => {
    if (input.outputMode) return input.outputMode;
    const instruction = input.userInstruction || '';
    if (isDocumentingIntent(instruction)) return 'document';
    if (isCommentingIntent(instruction)) return 'comment';
    return 'edit';
};

export const languageOf = (input: AIOutputPolicyInput): string | null => {
    if (input.language) return input.language;
    return resolveLanguageFromFilename(input.filename);
};

/**
 * Editor-safe output gate. Call this on ANY string that may be inserted into
 * the editor (autocomplete, `///` replacement, full-file edits, create-file,
 * AI fixes). Returns sanitized output that is safe to apply.
 *
 * Canonical pipeline (single source of truth for every editor-bound path):
 *   raw model output
 *     -> base editor sanitizer (reasoning / fences / wrappers)
 *     -> output policy (comment syntax, meta-commentary)
 *     -> `AICodeNormalizer` (line endings, safe fences, Python block repair)
 *     -> `AICodeValidator` (reject known-broken output)
 *     -> editor
 */
export const sanitizeEditorOutputWithPolicy = (
    raw: string,
    input: AIOutputPolicyInput = {},
): string => {
    if (!raw) return '';
    const mode = resolveOutputMode(input);

    // Always: strip reasoning/thinking blocks, fences, and wrapper lines.
    let out = baseSanitizeEditorOutput(raw);

    if (mode === 'comment' || mode === 'document') {
        // Additional defense-in-depth for comment mode: strip ALL reasoning
        // patterns anywhere in the content (not just leading lines), since
        // the model may embed reasoning within the comment text itself.
        out = stripReasoningAnywhere(out);
        
        // Comments are allowed: first strip AI process-voice meta-commentary
        // ("The user wants...", "Here is the comment...") while preserving
        // any existing comments in the file.
        out = stripAiMetaCommentary(out, input.preserve, true);

        // CRITICAL: applyCommentSyntax is ONLY for comment *snippets* (e.g.
        // "Print a greeting" -> "// Print a greeting"). When the model
        // returns a FULL FILE with comments + code (structured edit pipeline),
        // applying it would strip existing markers and re-prefix EVERY line
        // with "//", commenting out executable code. Detect full-file content
        // and skip the transform — the file already has correct syntax.
        const lang = languageOf(input);
        const looksLikeFullFile = (() => {
            if (!out.trim()) return false;
            // Heuristic: full file contains at least one non-comment code line
            // with code-like tokens (braces, semicolon, equals, function keywords).
            const nonCommentLines = out.split('\n').filter(l => {
                const t = l.trim();
                if (!t) return false;
                // Check if line starts with a known comment marker
                for (const m of KNOWN_MARKERS) {
                    if (t.startsWith(m)) return false;
                }
                return true;
            });
            if (nonCommentLines.length === 0) return false; // only comments -> snippet
            // If it has code-like syntax and is longer than a short snippet, treat as file
            // Only strong code punctuation / declarations are considered — generic
            // English words like "for", "if", "while" also appear in comments and
            // would cause false positives (e.g. "Styles for header").
            const hasCodeSyntax = /[;{}]/.test(out) || /\b(console\.|def\s+\w+\s*\(|function\s+\w+\s*\(|class\s+\w+|import\s+\w+|export\s+)\b/.test(out);
            // Also, if preserve was non-empty and out length is similar to preserve length, it's a file
            if (input.preserve && input.preserve.trim().length > 0 && out.length >= input.preserve.length * 0.5) {
                return hasCodeSyntax || nonCommentLines.length > 1;
            }
            return hasCodeSyntax;
        })();

        if (!looksLikeFullFile && lang) {
            out = applyCommentSyntax(out, lang);
        }
    } else {
        // Additional defense-in-depth: strip reasoning/process narration lines
        // that may have leaked through the base sanitizer (not inside thinking blocks)
        out = stripLeadingReasoningLines(out);
        
        // Comments are NOT part of the requested task: remove AI meta-commentary
        // (process + content voice) while preserving existing comments.
        out = stripAiMetaCommentary(out, input.preserve, false);
    }

    // Language-aware normalization (CRLF, safe fences, Python block-indent
    // repair) followed by validation. On failure we normalize once more
    // deterministically, validate again, and reject rather than ever insert
    // known-broken code.
    const language = languageOf(input);
    out = normalizeGeneratedCode(out, {
        language,
        filename: input.filename,
        preserve: input.preserve,
    });
    let validation = validateGeneratedCode(out, { language });
    if (!validation.valid) {
        out = normalizeGeneratedCode(out, {
            language,
            filename: input.filename,
            preserve: input.preserve,
        });
        validation = validateGeneratedCode(out, { language });
        if (!validation.valid) {
            console.warn('[AIOutputPolicy] Rejected AI output:', validation.reason);
            return '';
        }
    }

    return out;
};