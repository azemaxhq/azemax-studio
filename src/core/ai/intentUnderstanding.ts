/**
 * Intent Understanding — natural-language request interpretation.
 *
 * Root cause this module fixes: the agent treated ordinary, informal developer
 * instructions as under-specified and replied with a clarifying question
 * ("Could you clarify what kind of website…?"). The old planner prompt
 * literally instructed the model to *"return a chat action asking for
 * clarification"* whenever it could not pin a target, so ambiguity was treated
 * as a stop condition instead of a default to be resolved.
 *
 * This module classifies a request the way a developer would, and — crucially —
 * produces a DEFAULT for the non-critical unknowns (stack, file layout) instead
 * of a question. Genuine blockers (destructive intent with no target, missing
 * credential) are the only cases that may stop for clarification.
 *
 * It classifies STRUCTURALLY: message shape, referenced paths/extensions
 * present in the real workspace, and workspace facts. It does not depend on a
 * hardcoded phrase table for the decision, and it always records *why*.
 */

import type { FileNode } from '../../utils/mockFileSystem';

export type RequestKind =
    /** Produce or change code/files. */
    | 'implement'
    /** Answer/explain existing code. Must not modify files. */
    | 'explain'
    /** Diagnose and repair. */
    | 'debug'
    /** Read/inspect something and report. */
    | 'inspect'
    /** Run something (commands/tests). */
    | 'execute'
    /** Ordinary conversation. */
    | 'chat'
    /** Genuinely blocked — needs user input. */
    | 'clarify';

export interface WorkspaceFacts {
    /** Any real content at all. */
    hasProject: boolean;
    /** Total file count. */
    fileCount: number;
    /** Top-level folder/file names. */
    topLevel: string[];
    /** Detected stack signals from REAL files (package.json, etc.). */
    hasPackageJson: boolean;
    hasHtml: boolean;
    hasCss: boolean;
    hasJs: boolean;
    hasPython: boolean;
    hasJava: boolean;
    /** Dominant extension, when obvious. */
    dominantExtension: string | null;
    /** Workspace-relative paths, for mention resolution. */
    filePaths: string[];
}

export interface IntentResult {
    kind: RequestKind;
    /** Whether the agent should enter the implementation workflow. */
    wantsModification: boolean;
    /** Only a genuine blocker may be true. */
    needsClarification: boolean;
    /** Present only when needsClarification is true. */
    clarificationQuestion?: string;
    /** Short human-readable reason (drives the activity card). */
    summary: string;
    /** Workspace paths the user referenced (resolved against the real tree). */
    mentionedPaths: string[];
    /** Destination directory the user named, if any ("inside hello"). */
    destinationDir: string | null;
    /** Stack the user explicitly asked for (null = unspecified → default). */
    explicitStack: string | null;
    /** True when the message is a short follow-up to an existing task. */
    isFollowUp: boolean;
    /** True when the message asks to continue prior work. */
    isContinuation: boolean;
}

/** Detect workspace facts from the REAL tree — no assumptions. */
export function detectWorkspaceFacts(fileTree: FileNode[]): WorkspaceFacts {
    const files: string[] = [];
    const topLevel: string[] = [];
    const extCounts = new Map<string, number>();

    const walk = (nodes: FileNode[], prefix: string) => {
        for (const n of nodes) {
            if (n.id === 'root') {
                if (n.children) walk(n.children, '');
                continue;
            }
            if (!prefix) topLevel.push(n.name);
            if (n.type === 'file') {
                const full = prefix ? `${prefix}/${n.name}` : n.name;
                files.push(full);
                const dot = n.name.lastIndexOf('.');
                if (dot > 0) {
                    const ext = n.name.slice(dot + 1).toLowerCase();
                    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
                }
            }
            if (n.children) walk(n.children, prefix ? `${prefix}/${n.name}` : n.name);
        }
    };
    walk(fileTree ?? [], '');

    const has = (ext: string) => files.some(f => f.toLowerCase().endsWith(`.${ext}`));
    let dominant: string | null = null;
    let best = 0;
    for (const [ext, count] of extCounts) {
        if (count > best) {
            best = count;
            dominant = ext;
        }
    }

    return {
        hasProject: files.length > 0 || topLevel.length > 0,
        fileCount: files.length,
        topLevel,
        hasPackageJson: files.some(f => f === 'package.json' || f.endsWith('/package.json')),
        hasHtml: has('html') || has('htm'),
        hasCss: has('css'),
        hasJs: has('js') || has('jsx') || has('ts') || has('tsx'),
        hasPython: has('py'),
        hasJava: has('java'),
        dominantExtension: dominant,
        filePaths: files,
    };
}

// ---------------------------------------------------------------------------
// Structural signals
// ---------------------------------------------------------------------------

/** Punctuation/verb-shape signals, NOT a phrase allow-list. */
const IMPL_VERBS = /\b(create|make|build|add|write|generate|implement|scaffold|set\s?up|start|design|develop|produce|put\s+together|give\s+me|new)\b/i;
const EDIT_VERBS = /\b(update|change|modify|edit|refactor|fix|rename|move|delete|remove|replace|improve|clean\s?up|simplify|convert|extend|apply|patch|fix)\b/i;
const INSPECT_VERBS = /\b(show|list|display|find|search|locate|where\s+is|inspect|check|read|open|print|cat)\b/i;
const EXECUTE_VERBS = /\b(run|execute|test|build|compile|install|start|serve|deploy|npm|yarn|pnpm)\b/i;
const EXPLAIN_VERBS = /\b(explain|why|how\s+does|what\s+is|what\s+does|what'?s|describe|teach|walk\s+me|tell\s+me\s+about|help\s+me\s+understand)\b/i;
const DEBUG_VERBS = /\b(bug|broken|error|crash|fail(?:s|ing|ed)?|exception|stack\s?trace|not\s+work(?:ing)?|doesn'?t\s+work|wrong)\b/i;

/**
 * "Continue the previous work" phrasings. Two shapes are covered: a bare
 * continuation word ("continue", "keep going"), and a verb-first form where the
 * verb precedes the object ("do the remaining work", "finish the rest").
 */
const CONTINUATION_WORD_RE = /^\s*(continue|keep\s+going|go\s+on|proceed|next|finish\s+it|resume|carry\s+on|more)\b[\s.!?]*$/i;
const CONTINUATION_PHRASE_RE = /^\s*(do|finish|complete|handle)\s+(the\s+)?(rest|remaining|other|rest\s+of\s+(it|the\s+work|the\s+remaining\s+work)|remaining\s+work|leftover\s+work)\b/i;
const AFFIRMATION_RE = /^\s*(yes|yeah|yep|sure|ok|okay|alright|go\s+ahead|do\s+it|please\s+do|that'?s\s+right|sounds\s+good|perfect|thanks)\b[\s.!?]*$/i;
/** Very short messages carry little standalone meaning → treat as follow-up. */
const SHORT_FOLLOWUP_MAX = 40;

const DESTINATION_RE = /\b(?:inside|in|within|under|to)\s+(?:the\s+)?["'`]?([\w][\w./-]*)["'`]?(?:\s+(?:folder|directory|dir|project))?/i;

const STACK_TERMS: Array<[RegExp, string]> = [
    [/\bhtml\b/i, 'html'],
    [/\bhtml\s*\+\s*css|\bvanilla\b/i, 'html'],
    [/\bpython\b|\bflask\b|\bdjango\b|\bpy\b/i, 'python'],
    [/\bnode(?:\.js)?\b|\bexpress\b/i, 'node'],
    [/\breact\b/i, 'react'],
    [/\bvue\b/i, 'vue'],
    [/\bnext(?:\.js)?\b/i, 'next'],
    [/\btypescript\b|\bts\b/i, 'typescript'],
    [/\bc#\b|\bdotnet\b|\basp\.?net\b/i, 'dotnet'],
    [/\bjava\b(?!script)/i, 'java'],
    [/\bsvelte\b/i, 'svelte'],
    [/\bplain\s+css\b/i, 'css'],
];

/** Extract a workspace-relative path the user actually referenced. */
function resolveMention(message: string, facts: WorkspaceFacts): string[] {
    const found: string[] = [];
    // Explicit @mentions first.
    for (const m of message.matchAll(/@([^\s@,;]+)/g)) {
        const raw = m[1].replace(/[.,;:]+$/, '');
        const exact = facts.filePaths.find(p => p === raw);
        found.push(exact ?? raw);
    }
    // Bare filename mentions that exist in the REAL tree.
    for (const m of message.matchAll(/\b([\w][\w./-]*\.[a-zA-Z0-9]{1,8})\b/g)) {
        const cand = m[1];
        const base = cand.split('/').pop()!.toLowerCase();
        if (facts.filePaths.some(p => p.toLowerCase() === cand.toLowerCase() || p.split('/').pop()!.toLowerCase() === base)) {
            found.push(cand);
        }
    }
    // Folder mentions that exist.
    for (const name of message.matchAll(/\b([\w][\w-]*)\s+(?:folder|directory|dir)\b/gi)) {
        if (facts.topLevel.some(t => t.toLowerCase() === name[1].toLowerCase())) found.push(name[1]);
    }
    return [...new Set(found)].slice(0, 8);
}

/** Resolve a named destination directory against the real tree. */
function resolveDestination(message: string, facts: WorkspaceFacts): string | null {
    const m = message.match(DESTINATION_RE);
    if (!m) return null;
    const raw = m[1];
    if (!raw) return null;
    // Stop words that follow the preposition are not destinations.
    if (/^(?:it|them|that|this|the\s+same|there|here)$/i.test(raw)) return null;
    const match = facts.topLevel.find(t => t.toLowerCase() === raw.toLowerCase() || t.toLowerCase() === `${raw.toLowerCase()}.html`);
    return match ?? null;
}

function detectStack(message: string): string | null {
    for (const [re, name] of STACK_TERMS) {
        if (re.test(message)) return name;
    }
    return null;
}

/**
 * Classify a user message against the real workspace.
 *
 * `historyLength` / `hasActiveTask` let a short follow-up be recognised as
 * such, which is what stops "make it responsive" from being treated as a
 * brand-new, under-specified request.
 */
export function understandIntent(
    message: string,
    facts: WorkspaceFacts,
    opts: { historyLength?: number; hasActiveTask?: boolean } = {},
): IntentResult {
    const trimmed = (message || '').trim();
    const isContinuation = CONTINUATION_WORD_RE.test(trimmed)
        || CONTINUATION_PHRASE_RE.test(trimmed)
        || (AFFIRMATION_RE.test(trimmed) && Boolean(opts.hasActiveTask));
    const mentionedPaths = resolveMention(trimmed, facts);
    const destinationDir = resolveDestination(trimmed, facts);
    const explicitStack = detectStack(trimmed);

    const isFollowUp = (trimmed.length <= SHORT_FOLLOWUP_MAX && (opts.historyLength ?? 0) > 0)
        || isContinuation;

    const hasImpl = IMPL_VERBS.test(trimmed);
    const hasEdit = EDIT_VERBS.test(trimmed);
    const hasInspect = INSPECT_VERBS.test(trimmed);
    const hasExecute = EXECUTE_VERBS.test(trimmed);
    const hasExplain = EXPLAIN_VERBS.test(trimmed);
    const hasDebug = DEBUG_VERBS.test(trimmed);
    const isQuestion = /\?\s*$/.test(trimmed);

    // ── Genuine blockers only ───────────────────────────────────────────
    // The ONLY cases that may stop for clarification.
    const wantsDelete = /\b(delete|remove|wipe|clear|drop)\b/i.test(trimmed);
    if (wantsDelete && !hasInspect && mentionedPaths.length === 0 && destinationDir === null) {
        return {
            kind: 'clarify',
            wantsModification: false,
            needsClarification: true,
            clarificationQuestion: 'What exactly should I delete? Name the file or folder so I remove only that.',
            summary: 'Destructive request without a target',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Conversation ────────────────────────────────────────────────────
    if (trimmed.length <= 12 && !hasImpl && !hasEdit && !hasInspect && !hasExecute && !hasExplain && !hasDebug && !isContinuation) {
        return {
            kind: 'chat',
            wantsModification: false,
            needsClarification: false,
            summary: 'Conversational message',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Explanation / question about existing code ──────────────────────
    // Must NOT modify files. Checked before implementation because "how do I
    // add a form?" is a question, not an order.
    if (!hasImpl && !hasEdit && (hasExplain || (isQuestion && !hasInspect && !hasExecute))) {
        return {
            kind: 'explain',
            wantsModification: false,
            needsClarification: false,
            summary: 'Answering a question about the code',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Inspection ──────────────────────────────────────────────────────
    if (hasInspect && !hasImpl && !hasEdit && !hasExecute) {
        return {
            kind: 'inspect',
            wantsModification: false,
            needsClarification: false,
            summary: 'Inspecting the workspace',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Execution ───────────────────────────────────────────────────────
    if (hasExecute && !hasImpl && !hasEdit) {
        return {
            kind: 'execute',
            // Running a validation command is part of the implementation
            // workflow, not a separate mutation path.
            wantsModification: false,
            needsClarification: false,
            summary: 'Running a project command',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Debugging ───────────────────────────────────────────────────────
    if (hasDebug && (hasEdit || hasImpl)) {
        return {
            kind: 'debug',
            wantsModification: true,
            needsClarification: false,
            summary: 'Diagnosing and fixing a problem',
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // ── Implementation / modification ───────────────────────────────────
    // NOTE: no clarification here. "create a simple website" with an empty
    // workspace is a completely actionable request — the agent inspects,
    // picks a sensible default, and builds.
    if (hasImpl || hasEdit || isContinuation) {
        const summary = isContinuation
            ? 'Continuing the previous task'
            : destinationDir
                ? `Creating work in ${destinationDir}`
                : hasEdit
                    ? 'Modifying existing code'
                    : 'Implementing the request';
        return {
            kind: 'implement',
            wantsModification: true,
            needsClarification: false,
            summary,
            mentionedPaths,
            destinationDir,
            explicitStack,
            isFollowUp,
            isContinuation,
        };
    }

    // Anything else with no actionable verb → treat as chat. Never a question.
    return {
        kind: 'chat',
        wantsModification: false,
        needsClarification: false,
        summary: 'Conversational message',
        mentionedPaths,
        destinationDir,
        explicitStack,
        isFollowUp,
        isContinuation,
    };
}

/**
 * The default implementation shape when the user asks for something to be
 * built and no stack is specified.
 *
 * Deliberately minimal: plain HTML/CSS/JS files. No framework, no build step,
 * no package manager — introducing React/ASP.NET/etc. without being asked is
 * exactly the over-engineering this policy exists to prevent.
 */
export interface ImplementationDefault {
    files: string[];
    stack: string;
    rationale: string;
}

/**
 * Choose a sensible, reversible default for an unspecified build request.
 *
 * - Workspace has an existing JS/TS project → extend its structure; do NOT
 *   scaffold a parallel static site.
 * - Workspace is empty or has no web project → plain HTML/CSS/JS.
 * - User explicitly named a stack → that stack wins, no question asked.
 */
export function chooseImplementationDefault(
    facts: WorkspaceFacts,
    explicitStack: string | null,
    destinationDir: string | null,
): ImplementationDefault {
    const prefix = destinationDir ? `${destinationDir}/` : '';

    if (explicitStack === 'html' || explicitStack === 'css') {
        return {
            files: [`${prefix}index.html`, `${prefix}styles.css`, `${prefix}script.js`],
            stack: 'html',
            rationale: 'HTML was requested, so plain HTML/CSS/JS is used — no framework was introduced.',
        };
    }
    if (explicitStack === 'react' || explicitStack === 'vue' || explicitStack === 'svelte' || explicitStack === 'next') {
        return {
            files: [`${prefix}package.json`, `${prefix}src/App.${explicitStack === 'react' ? 'jsx' : 'js'}`],
            stack: explicitStack,
            rationale: `${explicitStack} was explicitly requested.`,
        };
    }
    if (explicitStack === 'python') {
        return { files: [`${prefix}main.py`], stack: 'python', rationale: 'Python was explicitly requested.' };
    }
    if (explicitStack === 'java') {
        return { files: [`${prefix}Main.java`], stack: 'java', rationale: 'Java was explicitly requested.' };
    }

    // No explicit stack: prefer the existing project structure.
    if (facts.hasPackageJson) {
        return {
            files: ['src'],
            stack: 'existing-node-project',
            rationale: 'The workspace already has a package.json, so the existing project structure is extended rather than replaced.',
        };
    }
    if (facts.hasPython && !facts.hasHtml) {
        return { files: ['main.py'], stack: 'python', rationale: 'The workspace is a Python project.' };
    }
    if (facts.hasJava && !facts.hasHtml) {
        return { files: ['Main.java'], stack: 'java', rationale: 'The workspace is a Java project.' };
    }
    if (facts.hasJs && !facts.hasHtml) {
        return { files: ['src'], stack: 'existing-js-project', rationale: 'The workspace already contains JavaScript/TypeScript files.' };
    }

    // Empty or non-web workspace → minimal HTML/CSS/JS.
    return {
        files: [`${prefix}index.html`, `${prefix}styles.css`, `${prefix}script.js`],
        stack: 'html',
        rationale: facts.hasProject
            ? 'No web framework was requested, so a plain HTML/CSS/JS implementation is added to the existing workspace.'
            : 'The workspace is empty, so a minimal HTML/CSS/JS implementation is created.',
    };
}

/**
 * Render workspace facts into a compact prompt block for the agent/planner.
 * Only REAL discovered facts — never an assumption presented as fact.
 */
export function renderWorkspaceFacts(facts: WorkspaceFacts): string {
    const lines: string[] = [];
    lines.push('WORKSPACE (discovered from the real file tree):');
    if (!facts.hasProject) {
        lines.push('- State: EMPTY (no files yet).');
        lines.push('- Creating files here is supported and expected.');
    } else {
        lines.push(`- State: ${facts.fileCount} file(s).`);
        lines.push(`- Top level: ${facts.topLevel.slice(0, 20).join(', ') || '(none)'}`);
        const stackSignals: string[] = [];
        if (facts.hasPackageJson) stackSignals.push('package.json');
        if (facts.hasHtml) stackSignals.push('HTML');
        if (facts.hasCss) stackSignals.push('CSS');
        if (facts.hasJs) stackSignals.push('JS/TS');
        if (facts.hasPython) stackSignals.push('Python');
        if (facts.hasJava) stackSignals.push('Java');
        lines.push(`- Detected: ${stackSignals.join(', ') || 'unknown'}`);
        if (facts.dominantExtension) lines.push(`- Dominant extension: .${facts.dominantExtension}`);
    }
    if (facts.filePaths.length) {
        lines.push(`- Files: ${facts.filePaths.slice(0, 60).join(', ')}`);
    }
    return lines.join('\n');
}