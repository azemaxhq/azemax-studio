/**
 * Canonical language-aware comment syntax registry.
 *
 * Single source of truth for comment delimiters across the entire application.
 * The application owns the syntax — never allow the model to decide delimiters.
 */

export interface CommentSyntax {
    /** Primary line comment marker (e.g., "//", "#", "--") */
    line?: string;
    /** Alternative line markers recognized for this language */
    lineAlt?: string[];
    /** Block comment start marker (e.g., "/*", "<!--") */
    blockStart?: string;
    /** Block comment end marker (e.g., "asterisk-slash", "-->") */
    blockEnd?: string;
    /** Whether the language supports comments at all */
    supported: boolean;
}

/** Primary comment syntax per language — the application owns this. */
const COMMENT_SYNTAX: Record<string, CommentSyntax> = {
    // C-style line + block
    typescript: { line: '//', lineAlt: ['///'], blockStart: '/*', blockEnd: '*/', supported: true },
    javascript: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    java: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    c: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    cpp: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    csharp: { line: '//', lineAlt: ['///'], blockStart: '/*', blockEnd: '*/', supported: true },
    go: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    rust: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    kotlin: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    swift: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    scala: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    php: { line: '//', lineAlt: ['#'], blockStart: '/*', blockEnd: '*/', supported: true },
    dart: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },

    // Hash-style line comments
    python: { line: '#', lineAlt: [], blockStart: '"""', blockEnd: '"""', supported: true },
    ruby: { line: '#', lineAlt: [], blockStart: '=begin', blockEnd: '=end', supported: true },
    shell: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    bash: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    zsh: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    powershell: { line: '#', lineAlt: [], blockStart: '<#', blockEnd: '#>', supported: true },
    perl: { line: '#', lineAlt: [], blockStart: '=begin', blockEnd: '=end', supported: true },
    r: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },

    // SQL-style
    sql: { line: '--', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },

    // HTML-style block comments (no line comment)
    html: { line: '', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },
    xml: { line: '', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },
    svg: { line: '', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },
    vue: { line: '//', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },
    svelte: { line: '//', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },

    // CSS-style block comments
    css: { line: '', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    scss: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    less: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    sass: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    stylus: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },

    // Config / data formats
    yaml: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    toml: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    ini: { line: ';', lineAlt: ['#'], blockStart: '', blockEnd: '', supported: true },
    conf: { line: '#', lineAlt: [';'], blockStart: '', blockEnd: '', supported: true },
    dockerfile: { line: '#', lineAlt: [], blockStart: '', blockEnd: '', supported: true },
    properties: { line: '#', lineAlt: ['!'], blockStart: '', blockEnd: '', supported: true },

    // No comments
    json: { line: '', lineAlt: [], blockStart: '', blockEnd: '', supported: false },
    jsonc: { line: '//', lineAlt: [], blockStart: '/*', blockEnd: '*/', supported: true },
    markdown: { line: '', lineAlt: [], blockStart: '<!--', blockEnd: '-->', supported: true },
    text: { line: '', lineAlt: [], blockStart: '', blockEnd: '', supported: false },

    // Terraform / HCL
    terraform: { line: '#', lineAlt: ['//'], blockStart: '/*', blockEnd: '*/', supported: true },
    hcl: { line: '#', lineAlt: ['//'], blockStart: '/*', blockEnd: '*/', supported: true },
};

/** Normalize a language identifier to our canonical key. */
export function normalizeLanguage(language?: string | null): string | null {
    if (!language) return null;
    const key = language.trim().toLowerCase().replace(/^\./, '');
    const aliases: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
        js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
        py: 'python', cs: 'csharp', 'c#': 'csharp', 'csharp': 'csharp',
        cpp: 'cpp', 'c++': 'cpp', 'c': 'c',
        sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell',
        ps1: 'powershell', powershell: 'powershell',
        rs: 'rust', rb: 'ruby', pl: 'perl',
        htm: 'html', svg: 'xml', vue: 'vue', svelte: 'svelte',
        jsonc: 'jsonc', md: 'markdown', markdown: 'markdown',
        tf: 'terraform', hcl: 'terraform',
    };
    return aliases[key] || key || null;
}

/**
 * Get the canonical comment syntax for a language.
 * Returns null if the language is unknown or doesn't support comments.
 */
export function getCommentSyntax(language?: string | null): CommentSyntax | null {
    const lang = normalizeLanguage(language);
    if (!lang) return null;
    return COMMENT_SYNTAX[lang] || { line: '', lineAlt: [], blockStart: '', blockEnd: '', supported: false };
}

/**
 * Apply canonical comment syntax to raw text.
 * Strips any existing comment markers/fences/quotes/meta from the text,
 * then wraps with the language's canonical syntax.
 * 
 * For line-comment languages: each non-empty line gets the line marker.
 * For block-only languages (CSS, HTML): wraps entire text in block markers.
 * For languages with both: uses line comments (more readable for multi-line).
 */
export function applyCommentSyntax(text: string, language?: string | null): string {
    const syntax = getCommentSyntax(language);
    if (!syntax || !syntax.supported) return '';

    // Normalize input: strip fences, quotes, "Here is..." meta, existing markers
    const normalized = extractCommentContent(text, syntax);

    if (!normalized.trim()) return '';

    // For line-comment languages: prefix each non-empty line
    if (syntax.line) {
        return normalized
            .split('\n')
            .map((line) => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                return `${syntax.line} ${trimmed}`;
            })
            .join('\n');
    }

    // For block-only languages: wrap the whole thing
    if (syntax.blockStart && syntax.blockEnd) {
        const inner = normalized.trim();
        if (!inner) return '';
        // For CSS: single line if short, multi-line block if multiple lines
        if (inner.includes('\n')) {
            return `${syntax.blockStart}\n${inner}\n${syntax.blockEnd}`;
        }
        return `${syntax.blockStart} ${inner} ${syntax.blockEnd}`;
    }

    return '';
}

/**
 * Extract clean comment content from model output.
 * Removes: markdown fences, quotes, "Here is the comment:" lines,
 * existing comment markers (///, //, #, etc.), reasoning/process narration.
 */
function extractCommentContent(text: string, syntax: CommentSyntax): string {
    if (!text) return '';

    let out = text.trim();

    // Strip markdown fences
    out = out.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim();

    // Strip wrapping quotes (single/double/backtick)
    out = out.replace(/^["'`]([\s\S]*?)["'`]$/, '$1').trim();

    // Strip common meta-commentary prefixes
    const metaPrefixes = [
        /^here is the comment:?\s*/i,
        /^here'?s the comment:?\s*/i,
        /^the comment:?\s*/i,
        /^comment[:]\s*/i,
        /^sure,? here'?s:?\s*/i,
        /^ok,? here'?s:?\s*/i,
        /^as requested:?\s*/i,
        /^per your request:?\s*/i,
    ];
    for (const re of metaPrefixes) {
        out = out.replace(re, '');
    }

    // Strip the /// trigger if echoed back
    out = out.replace(/^\/\/\/\s*/, '');

    // Strip any recognized comment markers at line starts
    const markers = new Set<string>(
        [
            syntax.line,
            ...(syntax.lineAlt || []),
            syntax.blockStart,
            syntax.blockEnd,
            '///', '//', '#', '--', '<!--', '/*', '*/', '-->', ';', '%',
        ].filter((m): m is string => Boolean(m))
    );
    for (const marker of markers) {
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`^[ \\t]*${escaped}\\s*`, 'gm'), '');
    }

    // Collapse excessive blank lines (max 1 consecutive)
    out = out.replace(/\n{3,}/g, '\n\n');

    return out.trim();
}

/**
 * Powerful: Get JSDoc/docstring syntax for functions/classes.
 * Returns block syntax for documentation, line syntax for regular comments.
 */
export function getDocCommentSyntax(language?: string | null): CommentSyntax | null {
    const syntax = getCommentSyntax(language);
    if (!syntax || !syntax.supported) return null;
    // For JS/TS/Java/Kotlin, use JSDoc /** */
    if (['typescript', 'javascript', 'java', 'kotlin', 'cpp', 'php'].includes(normalizeLanguage(language) || '')) {
        return { ...syntax, blockStart: '/**', blockEnd: ' */', supported: true };
    }
    // For Python, use docstring
    if (normalizeLanguage(language) === 'python') {
        return { line: '#', blockStart: '"""', blockEnd: '"""', supported: true };
    }
    return syntax;
}

/**
 * Check if a language supports comments.
 */
export function isCommentSupported(language?: string | null): boolean {
    const syntax = getCommentSyntax(language);
    return !!syntax?.supported;
}

/**
 * Get the primary line comment marker for display/UI purposes.
 */
export function getLineCommentMarker(language?: string | null): string {
    const syntax = getCommentSyntax(language);
    return syntax?.line || '';
}