/**
 * Agent Task Context — bounded, session-scoped state for one coding task.
 *
 * WHY THIS EXISTS
 * A short follow-up ("make it responsive", "using html", "inside the hello
 * folder") carries almost no meaning on its own. Interpreted in isolation it
 * looks ambiguous, which is exactly why the agent used to ask for
 * clarification. This module holds the *coherent task* the follow-ups belong
 * to:
 *
 *   original request → follow-ups → constraints → plan → operations → results
 *
 * It is NOT a conversation store. The full transcript stays where it already
 * lives (`AIAssistant` sessions / `chatStorage`); this holds only the compact,
 * task-shaped projection of it, with hard caps so it can never grow unbounded.
 *
 * Lifecycle is driven by the agent controller: `beginTask` on a new objective,
 * `recordPlan` once the model has decided, `recordOperations` as tools run,
 * `recordToolResults` for what came back, `finishTask` on completion. Follow-up
 * messages fold into the SAME task via `extendTask` — that is what makes
 * "add dark mode" modify the existing website instead of starting a new one.
 */

import type { AIRequestOptions, AIToolDefinition, ChatMessage } from './types';
import { resolvePath } from '../../utils/safeTree';
import type { FileNode } from '../../utils/mockFileSystem';

/**
 * Does a workspace-relative path exist in the file tree?
 *
 * Uses the canonical tree resolver so path semantics (folders, `..`, the
 * synthetic root) are identical to every other part of the product.
 */
export function pathExistsInTree(tree: FileNode[], path: string): boolean {
    if (!Array.isArray(tree) || !path) return false;
    try {
        return resolvePath(tree, path) !== null;
    } catch {
        return false;
    }
}

/** Single operation record — what was attempted, and what actually happened. */
export interface TaskOperation {
    /** Stable tool/action name, e.g. `create_file`, `read_file`. */
    tool: string;
    /** Workspace-relative path (or short target) the operation addressed. */
    target: string;
    status: 'ok' | 'error';
    /** Human-readable outcome; errors carry the real reason. */
    detail?: string;
    at: number;
}

/** A validation failure the agent must be able to see and correct. */
export interface TaskValidationFailure {
    path: string;
    message: string;
    at: number;
}

export interface AgentTaskContext {
    /** The original user objective this task serves. */
    objective: string;
    /** Follow-up instructions in order ("using html", "make it responsive"). */
    followUps: string[];
    /** Constraints accumulated from the conversation, e.g. "use plain HTML". */
    constraints: string[];
    /** Workspace-relative paths the user or agent has referenced. */
    mentionedPaths: string[];
    /** Latest plan summary from the semantic planner. */
    planSummary: string;
    /** Operations attempted, newest last. */
    operations: TaskOperation[];
    /** Files created/updated during this task (for follow-up targeting). */
    touchedPaths: string[];
    /** Real validation failures observed after changes. */
    validationFailures: TaskValidationFailure[];
    /**
     * File paths the MODEL itself announced it would work on, harvested from
     * its own messages.
     *
     * This is the "plan" side of the plan→completion linkage: the agent does
     * not guess what the task required, it reads the requirement out of what
     * the model said it was about to do. A path listed here that is neither in
     * the workspace nor intentionally removed is outstanding work.
     */
    announcedPaths: string[];
    /**
     * Announced paths that were still ABSENT from the workspace when the run
     * ended — the "remaining work" the final response must report instead of
     * letting the model's narrative imply completion.
     */
    remainingPaths: string[];
    /** Set once the task is considered finished. */
    completed: boolean;
    startedAt: number;
    updatedAt: number;
}

// Hard caps. A task must never be able to blow up the prompt.
const MAX_FOLLOW_UPS = 12;
const MAX_CONSTRAINTS = 12;
const MAX_MENTIONED_PATHS = 20;
const MAX_OPERATIONS = 40;
const MAX_TOUCHED_PATHS = 30;
const MAX_VALIDATION_FAILURES = 15;
const MAX_ANNOUNCED_PATHS = 30;
const MAX_ITEM_CHARS = 200;

const clamp = (s: string, n = MAX_ITEM_CHARS): string =>
    (typeof s === 'string' ? s : String(s ?? '')).trim().slice(0, n);

export function createTaskContext(objective: string): AgentTaskContext {
    const now = Date.now();
    return {
        objective: clamp(objective, 500),
        followUps: [],
        constraints: [],
        mentionedPaths: [],
        planSummary: '',
        operations: [],
        touchedPaths: [],
        validationFailures: [],
        announcedPaths: [],
        remainingPaths: [],
        completed: false,
        startedAt: now,
        updatedAt: now,
    };
}

/**
 * Append with a cap and de-duplication. Returns the SAME array when the entry
 * is a duplicate, so callers can detect no-ops.
 */
function pushCapped(list: string[], value: string, max: number): string[] {
    const v = clamp(value);
    if (!v) return list;
    if (list.includes(v)) return list;
    const next = [...list, v];
    return next.length > max ? next.slice(next.length - max) : next;
}

/** Fold a follow-up message into the existing task. */
export function extendTask(ctx: AgentTaskContext, message: string): AgentTaskContext {
    const text = clamp(message, 500);
    return {
        ...ctx,
        followUps: pushCapped(ctx.followUps, text, MAX_FOLLOW_UPS),
        updatedAt: Date.now(),
    };
}

/** Record the planner's decision. */
export function recordPlan(ctx: AgentTaskContext, summary: string): AgentTaskContext {
    return { ...ctx, planSummary: clamp(summary, 300), updatedAt: Date.now() };
}

/**
 * Fold a structured constraint into the task. Used for destination
 * ("inside hello") and approach ("using html") constraints detected by the
 * intent layer, so they survive into every later turn of the same task.
 */
export function addConstraint(ctx: AgentTaskContext, constraint: string, path?: string): AgentTaskContext {
    const next: AgentTaskContext = {
        ...ctx,
        constraints: pushCapped(ctx.constraints, constraint, MAX_CONSTRAINTS),
        updatedAt: Date.now(),
    };
    if (path) next.mentionedPaths = pushCapped(next.mentionedPaths, path, MAX_MENTIONED_PATHS);
    return next;
}

export function addMentionedPath(ctx: AgentTaskContext, path: string): AgentTaskContext {
    return { ...ctx, mentionedPaths: pushCapped(ctx.mentionedPaths, path, MAX_MENTIONED_PATHS), updatedAt: Date.now() };
}

/** Record a real tool operation result. */
export function recordOperation(ctx: AgentTaskContext, op: Omit<TaskOperation, 'at'>): AgentTaskContext {
    const entry: TaskOperation = { ...op, target: clamp(op.target), detail: op.detail ? clamp(op.detail) : undefined, at: Date.now() };
    const operations = [...ctx.operations, entry];
    const next: AgentTaskContext = {
        ...ctx,
        operations: operations.length > MAX_OPERATIONS ? operations.slice(operations.length - MAX_OPERATIONS) : operations,
        updatedAt: Date.now(),
    };
    if (op.status === 'ok' && op.target && MUTATING_TOOLS.has(op.tool)) {
        next.touchedPaths = pushCapped(ctx.touchedPaths, op.target, MAX_TOUCHED_PATHS);
    }
    return next;
}

/**
 * Tools whose success implies the workspace was changed.
 *
 * Kept in sync with `AGENT_TOOL_SCHEMAS[].mutating` (see `agentTools.ts`).
 * `create_directory` belongs here: it mutates the workspace, so it must show
 * up in `touchedPaths` and in the verification story.
 */
const MUTATING_TOOLS = new Set([
    'create_directory',
    'create_file',
    'write_file',
    'replace_range',
    'insert_text',
    'delete_range',
    'rename_file',
    'delete_file',
]);

/**
 * Harvest file paths the model announced in its own prose.
 *
 * This is how the agent learns what work it claimed to do, without a second
 * planner call: the requirement is read out of the model's own words.
 *
 * Two filters keep ordinary prose from becoming a phantom requirement:
 *   1. the token must look like a source file (known extension);
 *   2. the SENTENCE must contain an INTENTION cue ("I'll create X", "now
 *      let me add X", "X still needs to be written").
 *
 * Without filter 2, a purely descriptive sentence ("there is no config.json
 * in this workspace") would look like outstanding work, and the agent would
 * chase a file it was only ever talking about.
 */
const ANNOUNCED_PATH_RE = /(?:^|[\s"'`([{,])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?=$|[\s"'`)\]},:;])/g;

/** Extensions a source file plausibly has. Keeps prose out of the harvest. */
const ANNOUNCED_EXTENSIONS = new Set([
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'mjs', 'cjs',
    'ts', 'tsx', 'json', 'py', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'c', 'h',
    'cpp', 'hpp', 'cs', 'swift', 'vue', 'svelte', 'md', 'mdx', 'txt', 'yml',
    'yaml', 'xml', 'sh', 'sql', 'env',
]);

/**
 * Words that signal the model is about to DO something to a file, as opposed
 * to merely describing one.
 */
const INTENTION_CUE_RE = new RegExp([
    '\\bcreat', '\\bwrit', '\\badd', '\\bbuild', '\\bmak', '\\bgenerat',
    '\\bimplement', '\\bscaffold', '\\bset\\s?up', '\\bneed(?:s|ed)?\\s+to\\b',
    '\\brequir', '\\bremain', '\\bstill\\b', '\\bnext\\b', '\\bnow\\b',
    '\\bwill\\b', "\\blet'?s\\b", '\\bgoing\\s+to\\b', '\\bplan(?:ning)?\\b',
    '\\bstart(?:ing)?\\b', '\\bproceed', '\\bthen\\b', '\\balso\\b', '\\bplus\\b',
    '\\bupdat', '\\bmodif', '\\bedit', '\\breplac', '\\bremov', '\\bdelet',
    '\\brenam', '\\bmov', '\\binsert',
].join('|'), 'i');

/** Split prose into sentence-ish segments so a cue must be nearby. */
function splitSentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+|\r?\n+/).filter(s => s.trim().length > 0);
}

export function extractAnnouncedPaths(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const sentence of splitSentences(text)) {
        if (!INTENTION_CUE_RE.test(sentence)) continue;
        for (const m of sentence.matchAll(ANNOUNCED_PATH_RE)) {
            const raw = m[1];
            if (!raw) continue;
            // Strip a trailing sentence period that is not part of the extension.
            const cleaned = raw.replace(/\.+$/, '');
            const dot = cleaned.lastIndexOf('.');
            if (dot <= 0) continue;
            const ext = cleaned.slice(dot + 1).toLowerCase();
            if (!ANNOUNCED_EXTENSIONS.has(ext)) continue;
            if (seen.has(cleaned)) continue;
            seen.add(cleaned);
            out.push(cleaned);
        }
    }
    return out;
}

/**
 * Record the paths the model said it was going to create/modify.
 *
 * This is the ONLY signal used to decide whether a text-only turn really
 * means "done" — the agent is not asked to remember a plan, it is asked what
 * it just said it would do.
 */
export function recordAnnouncedPaths(ctx: AgentTaskContext, text: string): AgentTaskContext {
    const paths = extractAnnouncedPaths(text);
    if (paths.length === 0) return ctx;
    let next = ctx;
    for (const p of paths) {
        next = { ...next, announcedPaths: pushCapped(next.announcedPaths, p, MAX_ANNOUNCED_PATHS) };
    }
    return { ...next, updatedAt: Date.now() };
}

/**
 * Compute the announced paths that are still absent from the workspace.
 *
 * `exists` answers "is this path present in the workspace right now?". A
 * path is OUTSTANDING when the model announced it and it is neither in the
 * workspace nor recorded as a deliberate deletion.
 */
export function computeRemainingPaths(
    ctx: AgentTaskContext,
    exists: (path: string) => boolean,
): string[] {
    const deleted = new Set(
        ctx.operations
            .filter(o => o.status === 'ok' && o.tool === 'delete_file')
            .map(o => o.target),
    );
    const out: string[] = [];
    for (const p of ctx.announcedPaths) {
        if (deleted.has(p)) continue;
        if (exists(p)) continue;
        out.push(p);
    }
    return out;
}

/** Record a real validation failure (diagnostics/build). Never fabricated. */
export function recordValidationFailure(ctx: AgentTaskContext, path: string, message: string): AgentTaskContext {
    const failures = [...ctx.validationFailures, { path: clamp(path), message: clamp(message, 400), at: Date.now() }];
    return {
        ...ctx,
        validationFailures: failures.length > MAX_VALIDATION_FAILURES
            ? failures.slice(failures.length - MAX_VALIDATION_FAILURES)
            : failures,
        updatedAt: Date.now(),
    };
}

export function finishTask(ctx: AgentTaskContext): AgentTaskContext {
    return { ...ctx, completed: true, updatedAt: Date.now() };
}

/**
 * Whether the agent may treat a text-only turn as "the task is done".
 *
 * The loop used to treat ANY model turn without tool calls as completion.
 * That is wrong for a modification task: providers routinely split a turn,
 * and the model frequently emits an intermediate "now let me create the CSS
 * file…" message with no tool calls attached. The run then ended after the
 * first file with `success: true`.
 *
 * The rule here is deliberately conservative and evidence-based:
 *   - a task that has already FAILED an operation is not complete;
 *   - a task that has OUTSTANDING announced work is not complete;
 *   - a task that changed nothing and announced nothing is complete (the
 *     model was asked a question and answered it).
 *
 * `outstanding` is computed from the model's own announcements and the real
 * workspace, so this never invents work — it only refuses to call an
 * unfinished task finished.
 */
export function isTaskComplete(ctx: AgentTaskContext, outstanding: string[]): boolean {
    if (ctx.operations.some(o => o.status === 'error')) return false;
    if (outstanding.length > 0) return false;
    return true;
}

/**
 * True when the run produced a real workspace change.
 *
 * Distinct from "complete": a run can be complete and change nothing (a
 * question answered from real workspace state).
 */
export function hasRealMutations(ctx: AgentTaskContext): boolean {
    return ctx.operations.some(
        o => o.status === 'ok' && MUTATING_TOOLS.has(o.tool),
    );
}

/** Successful file operations performed so far, for the completion summary. */
export function completedFiles(ctx: AgentTaskContext): string[] {
    return [...new Set(ctx.touchedPaths)];
}

/** True when the model previously asked for a tool and got the same error. */
export function hasRepeatedFailure(ctx: AgentTaskContext, tool: string, detail: string): boolean {
    const matches = ctx.operations.filter(o => o.tool === tool && o.status === 'error' && o.detail === clamp(detail));
    return matches.length >= 2;
}

/**
 * Render the task context as a bounded prompt block.
 *
 * Returns '' when there is nothing meaningful, so callers can append it
 * unconditionally without polluting simple requests.
 */
export function renderTaskContext(ctx: AgentTaskContext): string {
    const lines: string[] = [];
    lines.push(`ORIGINAL TASK: ${ctx.objective}`);
    if (ctx.followUps.length) {
        lines.push('USER FOLLOW-UPS (in order — these MODIFY the original task, they do not replace it):');
        for (const f of ctx.followUps) lines.push(`  - ${f}`);
    }
    if (ctx.constraints.length) {
        lines.push(`ACTIVE CONSTRAINTS (must still hold): ${ctx.constraints.join(' | ')}`);
    }
    if (ctx.mentionedPaths.length) {
        lines.push(`PATHS MENTIONED BY USER: ${ctx.mentionedPaths.join(', ')}`);
    }
    if (ctx.touchedPaths.length) {
        lines.push(`FILES CREATED/MODIFIED SO FAR IN THIS TASK: ${ctx.touchedPaths.join(', ')}`);
    }
    if (ctx.planSummary) {
        lines.push(`CURRENT PLAN: ${ctx.planSummary}`);
    }
    const failed = ctx.operations.filter(o => o.status === 'error').slice(-5);
    if (failed.length) {
        lines.push('FAILED OPERATIONS (do not repeat these verbatim — fix or work around):');
        for (const f of failed) lines.push(`  - ${f.tool} ${f.target}: ${f.detail ?? 'failed'}`);
    }
    if (ctx.validationFailures.length) {
        lines.push('VALIDATION FAILURES (must be corrected):');
        for (const v of ctx.validationFailures.slice(-5)) lines.push(`  - ${v.path}: ${v.message}`);
    }
    return lines.join('\n');
}

/**
 * Compose the messages for an agent step: system prompt, bounded task context,
 * conversation tail, then the current user message.
 *
 * History is trimmed to a small window (the task context already carries the
 * durable state), so a long conversation cannot grow the prompt without bound.
 */
export function buildAgentMessages(input: {
    systemPrompt: string;
    taskContext: AgentTaskContext;
    history: ChatMessage[];
    userMessage: string;
    historyWindow?: number;
    /** Discovered workspace facts + chosen default (from the controller). */
    workspaceContextBlock?: string;
}): ChatMessage[] {
    const window = input.historyWindow ?? 6;
    const tail = input.history.slice(-window);
    const parts: string[] = [];
    if (input.workspaceContextBlock) parts.push(input.workspaceContextBlock);
    const taskBlock = renderTaskContext(input.taskContext);
    if (taskBlock) parts.push(taskBlock);
    parts.push(`CURRENT USER INSTRUCTION: ${input.userMessage}`);
    return [
        { role: 'system', content: input.systemPrompt },
        ...tail,
        { role: 'user', content: parts.join('\n\n') },
    ];
}

/**
 * The agent system prompt.
 *
 * This establishes BEHAVIOR only. Autonomy comes from the tools, the loop, the
 * workspace context and verification — not from prompt length. The
 * clarification policy is stated positively: proceed by default, ask only
 * under the enumerated genuine-blocker conditions.
 */
export const AGENT_SYSTEM_PROMPT = `You are the autonomous coding agent inside the Azemax IDE. You have REAL tools that read and change the user's workspace.

HOW TO WORK:
1. Understand the goal against the task context and workspace you are given.
2. Inspect before you write: use the read tools (list_files, read_file, search_files, get_file_info, get_diagnostics, get_editor_context) to learn the real state of the workspace.
3. Then act: use the write tools to make the actual changes.
4. After writing, verify: re-read or run diagnostics on what you changed and correct real problems.
5. Keep going until the task is done. Do not stop to ask permission for ordinary, reversible work.

TOOL USE RULES:
- Call tools when you need facts or need to change files. Do not guess file contents, paths, or project structure.
- Multiple tool calls in one turn are fine and encouraged when they are independent.
- One tool per call: pass each argument in the tool's own parameter object.
- Only use tools that are listed. Do not invent tool names.

CLARIFICATION POLICY (important):
- For ordinary coding requests, DO NOT ask the user to choose a stack, a file name, a location, or a framework unless they asked for a specific one. Inspect the workspace, pick a sensible default, and build it.
- If the workspace is empty and no framework was specified, create plain HTML/CSS/JS files. Do NOT introduce a framework or a build step that the user did not ask for.
- Never reply with a question as your only action when you could reasonably proceed.
- Ask the user ONLY for a genuine blocker: (a) required information is truly unavailable, (b) two readings of the request would produce materially different deliverables, (c) the operation is destructive or security-sensitive, (d) a permission or credential is missing, or (e) the task cannot be completed safely without input.
- When you do have to ask, still do any safe, clearly-implied work first, then ask.

FOLLOW-UPS:
- The task context lists the original task and the user's follow-ups. A follow-up modifies that task; continue the same work instead of starting over.

COMPLETION:
- When the work is done, reply with a short plain-text summary of what you actually changed. Only claim files you really created or modified through the tools.`;

export interface AgentRequestDefaults {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    allowFallback?: boolean;
}

/** Bounded execution budgets for one agent task (see agentLoop). */
export interface AgentBudget {
    /** Max provider round-trips. */
    maxSteps: number;
    /** Max individual tool executions. */
    maxToolCalls: number;
    /** Wall-clock ceiling in ms. */
    timeoutMs: number;
    /** Max chars per single tool result fed back to the model. */
    maxToolResultChars: number;
    /** Max total chars across all tool results in the task. */
    maxTotalToolResultChars: number;
    /** Per-tool timeout. */
    toolTimeoutMs: number;
    /** Max wall time for ONE model round-trip inside the loop. Prevents a
     *  hung provider request from stalling the agent past the task budget. */
    modelCallTimeoutMs: number;
    /** Max read-only tool calls executed concurrently within one step. */
    maxConcurrentReads: number;
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
    maxSteps: 12,
    maxToolCalls: 40,
    timeoutMs: 120_000,
    maxToolResultChars: 8_000,
    maxTotalToolResultChars: 40_000,
    toolTimeoutMs: 15_000,
    modelCallTimeoutMs: 90_000,
    maxConcurrentReads: 4,
};

/** Tools exposed to the model. Kept here so the loop and prompt agree. */
export interface AgentToolSet {
    definitions: AIToolDefinition[];
    names: string[];
}

export type { AIRequestOptions };