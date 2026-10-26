/**
 * Agent Controller — the real autonomous agent entry point.
 *
 * REPLACES the previous single-shot "plan once, apply once" pipeline. The old
 * controller asked the model for a plan, ran a fixed list of read tools,
 * generated one edit, applied it, and finished — with no cycle, so the model
 * never saw a tool result and could not continue. It also ran with
 * `preview: true`, so nothing was ever written without a manual Accept.
 *
 * The lifecycle implemented here:
 *
 *   UNDERSTAND ──▶ INSPECT WORKSPACE ──▶ PLAN CHANGES ──▶ SELECT+EXECUTE TOOLS
 *        ▲                                                            │
 *        │                                                            ▼
 *        │                                                    READ TOOL RESULTS
 *        │                                                            │
 *        └──── CORRECT AND RETRY ◀── VALIDATE CHANGES ◀───────────────┘
 *                                    │
 *                                    ▼
 *                            VERIFY COMPLETION ──▶ SUMMARIZE
 *
 * The cycle lives in `runAgentLoop` (bounded steps, real tool results fed back
 * to the model). This module owns the parts around it: task context, intent,
 * workspace discovery, the confirmation gate, validation, and the summary.
 */

import { getActiveEditorContext } from '../editor/activeEditorStore';
import { recordRecentEdit } from '../workspace/liveIDEContext';
import { createPreviewWorkspace, type PreviewWorkspace, type ProposedChange } from '../editor/previewWorkspace';
import { createExecutorDeps, type WorkspaceBridgeActions, findNodeByPath } from '../editor/workspaceBridge';
import { runAgentLoop, type AgentLoopResult, type AgentStepRecord } from './agentLoop';
import { resolveByokTarget } from './byokRuntime';
import type { ResolvedByokTarget } from './byokTypes';
import { executeActionPlan } from './aiToolExecutor';
import type { AIAction, ExecutionResult } from './actionTypes';
import type { AgentToolDeps } from './agentTools';
import {
    createTaskContext,
    extendTask,
    addConstraint,
    addMentionedPath,
    computeRemainingPaths,
    pathExistsInTree,
    recordPlan,
    recordValidationFailure,
    DEFAULT_AGENT_BUDGET,
    type AgentBudget,
    type AgentTaskContext,
} from './agentTaskContext';
import {
    chooseImplementationDefault,
    detectWorkspaceFacts,
    renderWorkspaceFacts,
    understandIntent,
    type IntentResult,
} from './intentUnderstanding';
import type { FileNode } from '../../utils/mockFileSystem';
import type { ChatMessage } from './types';
import { AIRequestStore, type AgentTaskPhase } from './aiRequestStore';
import type { WorkspaceSnapshot } from '../workspace/workspaceContext';

export type AgentToolStatus = 'running' | 'done' | 'error';
export interface AgentActivity {
    id: string;
    tool: string;
    status: AgentToolStatus;
    message: string;
    path?: string;
    detail?: string;
}

/**
 * Stable activity identity.
 *
 * A stage that starts as 'running' and later becomes 'done' MUST keep the same
 * id, otherwise the 'running' row is never updated and its animated dots spin
 * forever next to a finished task. Ids are therefore derived from the stage
 * key (plus a per-run nonce), never from the clock.
 */
const activitySeq = { n: 0 };
const makeActivityId = (stage: string): string => `${stage}#${++activitySeq.n}`;

/**
 * Stage → display label.
 *
 * Deliberately separate from internal orchestration wording: these are the
 * stage names a user can act on, and each one only appears when the
 * corresponding work ACTUALLY started.
 */
const STAGE_LABELS: Record<string, string> = {
    understand: 'Understanding your request',
    inspect: 'Inspecting workspace',
    plan: 'Planning changes',
    read: 'Reading relevant files',
    create: 'Creating files',
    update: 'Updating code',
    check: 'Running checks',
    fix: 'Fixing reported issues',
    summarize: 'Preparing final summary',
};

/** Map a tool name onto its user-facing stage label. */
export function stageLabelForTool(tool: string): string {
    switch (tool) {
        case 'list_files':
        case 'read_file':
        case 'search_files':
        case 'get_file_info':
        case 'get_editor_context':
            return STAGE_LABELS.read;
        case 'create_file':
        case 'create_directory':
            return STAGE_LABELS.create;
        case 'write_file':
        case 'replace_range':
        case 'insert_text':
        case 'delete_range':
            return STAGE_LABELS.update;
        case 'rename_file':
        case 'delete_file':
            return STAGE_LABELS.update;
        case 'get_diagnostics':
            return STAGE_LABELS.check;
        default:
            return STAGE_LABELS.plan;
    }
}

export interface AgentRequestContext {
    fileName: string | null;
    filePath: string | null;
    fileId: string | null;
    language: string | null;
    documentVersionId: number | null;
    extension: string | null;
    className: string | null;
    moduleName: string | null;
    selectionText: string | null;
    selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
    requestId: string | null;
}

export interface AgentControllerRequest {
    userMessage: string;
    workspace: WorkspaceBridgeActions;
    fileName: string | null;
    fileId?: string | null;
    history?: ChatMessage[];
    signal?: AbortSignal;
    onActivity?: (activity: AgentActivity) => void;
    /**
     * Task id this run belongs to (from `AIRequestStore`). Supplied by the
     * caller so progress events are attributed to the exact request that owns
     * them; resolved from the store when omitted.
     */
    taskId?: string;
    /** Lifecycle phase transitions. */
    onPhase?: (phase: AgentTaskPhase, label?: string) => void;
    /** Internal execution events (never assistant prose). */
    onProgress?: (event: {
        phase: AgentTaskPhase;
        label: string;
        detail?: string;
        tool?: string;
        status: 'running' | 'done' | 'error';
    }) => void;
    /** Pinned context from request creation time — prevents stale file switch. */
    requestContext?: AgentRequestContext | null;
    /**
     * Pre-built WorkspaceSnapshot from the request origin. When provided, this
     * snapshot is used for all context building instead of re-fetching the file
     * tree and editor state. This eliminates redundant context construction
     * across the planner, dynamic context, and agent loop.
     */
    workspaceSnapshot?: WorkspaceSnapshot | null;
    /**
     * Continue an existing task instead of starting a new one. Supplied by the
     * chat panel, which owns the conversation, so a short follow-up inherits
     * the original objective and the files already changed.
     */
    previousTask?: AgentTaskContext | null;
    /**
     * Preview mode (Accept/Reject gate). The agent still runs its full tool
     * loop, but mutations apply into a shadow tree and the caller must accept
     * them. Defaults to FALSE — Agent mode applies reversible work directly
     * and only gates destructive operations behind explicit confirmation.
     */
    preview?: boolean;
    /**
     * Approval callback for destructive tools (delete/rename). Returning false
     * denies the operation; the agent then reports honestly and stops.
     */
    confirmDestructive?: (tool: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
    /** Folder creation, bound to the workspace's folder-creation path. */
    createDirectory?: (path: string) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>;
    budget?: Partial<AgentBudget>;
    /** Requested model for agent steps. */
    model?: string;
    /**
     * A pinned BYOK provider target for the whole task.
     *
     * When omitted, the controller resolves the user's selected provider
     * ONCE at task start and pins it, so a settings change during the task
     * cannot switch the running loop to a different provider or credential.
     */
    providerTarget?: ResolvedByokTarget;
    /**
     * Callback when a file is created or updated. Allows the UI to open the
     * file in Monaco and highlight it in the explorer immediately.
     * Called DURING tool execution for streaming updates.
     */
    onFileChanged?: (path: string, action: 'created' | 'updated' | 'deleted', content?: string) => void;
}

export interface AgentControllerResult extends ExecutionResult {
    wasChatOrExplain?: boolean;
    chatResponse?: string;
    activities: AgentActivity[];
    planSummary: string;
    diffs?: Array<{ file: string; added: number; removed: number; summary: string }>;
    /** Preview mode only: ordered before/after changes awaiting approval. */
    proposedChanges?: ProposedChange[];
    /** True when real tool executions mutated the workspace. */
    changedWorkspace?: boolean;
    /** Why the agent stopped. */
    stopReason?: AgentLoopResult['stopReason'];
    /** Task context after the run (operation log, touched files). */
    taskContext?: AgentTaskContext;
    /** Real validation results (never fabricated). */
    validation?: Array<{ path: string; isError: boolean; markers: number }>;
}

/**
 * Run the autonomous agent for one user request.
 *
 * Returns a truthful result: `changedWorkspace` reflects real successful
 * mutations, `validation` reflects real diagnostics, and `message` is generated
 * from what actually happened rather than what was intended.
 */
export async function runAgentController(req: AgentControllerRequest): Promise<AgentControllerResult> {
    const activities: AgentActivity[] = [];
    const push = (a: AgentActivity) => {
        const idx = activities.findIndex(x => x.id === a.id);
        if (idx >= 0) activities[idx] = a;
        else activities.push(a);
        req.onActivity?.(a);
    };
    /** Discovered workspace facts, injected into the loop's leading context. */
    let workspaceContextBlock = '';

    /**
     * Pin the BYOK provider target for the WHOLE task.
     *
     * The user's selected provider, model and credential are resolved once
     * here and reused for every model call in this task. A settings change
     * made while the task runs therefore applies to the NEXT task, not to
     * this one — the running task keeps a consistent provider identity.
     *
     * A resolution failure is NOT fatal here: the loop surfaces the real
     * error on its first model call, which keeps the failure report truthful.
     */
    let providerTarget: ResolvedByokTarget | undefined = req.providerTarget;
    if (!providerTarget) {
        try {
            providerTarget = (await resolveByokTarget()) ?? undefined;
        } catch {
            providerTarget = undefined;
        }
    }

    /**
     * Task lifecycle, keyed to the request that owns this run.
     *
     * `taskId` is resolved once from the existing `AIRequestStore` — the same
     * store that drives the loading indicator — so there is exactly ONE task
     * identity in the system. Every phase/progress emission is stamped with it,
     * which is what makes a stale async callback harmless: the store drops
     * events whose task is no longer current.
     */
    const taskId: string = req.taskId ?? AIRequestStore.getActiveRequestForOperation('chat')?.id ?? '';
    const setPhase = (phase: AgentTaskPhase, label?: string, detail?: string) => {
        if (taskId) AIRequestStore.setPhase(taskId, phase, label, detail);
        req.onPhase?.(phase, label);
    };
    const progress = (event: { phase: AgentTaskPhase; label: string; detail?: string; tool?: string; status: 'running' | 'done' | 'error' }) => {
        if (taskId) AIRequestStore.emitProgressEvent(taskId, event);
        req.onProgress?.(event);
    };

    // ── [1] UNDERSTAND ──────────────────────────────────────────────────
    setPhase('understanding', STAGE_LABELS.understand);
    const interpreting: AgentActivity = { id: makeActivityId('understand'), tool: 'understand', status: 'running', message: STAGE_LABELS.understand };
    push(interpreting);

    // Use pre-built WorkspaceSnapshot when provided to avoid redundant context construction
    const fileTree = req.workspaceSnapshot?.fileTree ?? (req.workspace.getFileTree() as FileNode[]);
    const facts = detectWorkspaceFacts(fileTree);
    // A supplied `previousTask` means the conversation already has a coherent
    // task. The chat panel decides when a message starts a NEW objective (it
    // clears the task); the controller therefore extends whatever it is given.
    // Ignoring `completed` here is deliberate: a finished task plus "add dark
    // mode" is still one task, not two.
    const hasActiveTask = Boolean(req.previousTask);

    const intent: IntentResult = understandIntent(req.userMessage, facts, {
        historyLength: req.history?.length ?? 0,
        hasActiveTask,
    });
    // The internal classification ("Conversational message", "Continuing the
    // previous task") is NOT user-facing text — it stays internal. What the
    // user sees is the stage, which is complete.
    interpreting.status = 'done';
    push({ ...interpreting });
    progress({ phase: 'understanding', label: STAGE_LABELS.understand, status: 'done' });

    // Genuine blocker — the ONLY path that returns a question.
    if (intent.needsClarification) {
        return {
            success: true,
            appliedCount: 0,
            wasChatOrExplain: true,
            message: intent.clarificationQuestion ?? 'I need one more detail before I can proceed safely.',
            chatResponse: intent.clarificationQuestion,
            activities,
            planSummary: intent.summary,
            stopReason: 'approval_required',
        };
    }

    // ── Task context: continue the existing task, or start a new one ────
    let taskContext: AgentTaskContext;
    if (hasActiveTask && req.previousTask) {
        taskContext = extendTask(req.previousTask, req.userMessage);
    } else {
        taskContext = createTaskContext(req.userMessage);
    }
    for (const p of intent.mentionedPaths) taskContext = addMentionedPath(taskContext, p);
    if (intent.destinationDir) {
        taskContext = addConstraint(taskContext, `destination: ${intent.destinationDir}`, intent.destinationDir);
    }
    if (intent.explicitStack) {
        taskContext = addConstraint(taskContext, `stack: ${intent.explicitStack}`);
    }

    // Workspace discovery decides the implementation shape. When the user
    // named no stack, a sensible default is chosen here — this is the code
    // that makes "create a simple website" actionable instead of ambiguous.
    const defaultImpl = chooseImplementationDefault(facts, intent.explicitStack, intent.destinationDir);
    taskContext = addConstraint(taskContext, `implementation default: ${defaultImpl.stack} — ${defaultImpl.rationale}`);
    for (const f of defaultImpl.files) {
        if (f.includes('/') && !f.includes('.')) taskContext = addMentionedPath(taskContext, f);
    }
    taskContext = recordPlan(
        taskContext,
        `${intent.summary} — workspace: ${facts.hasProject ? `${facts.fileCount} file(s)` : 'empty'}`,
    );
    // ── [2] INSPECT WORKSPACE ───────────────────────────────────────────
    // The stage is announced BEFORE inspection starts (never after), and the
    // real discovered counts are the secondary detail — never the headline.
    const inspectActivity: AgentActivity = { id: makeActivityId('inspect'), tool: 'inspect', status: 'running', message: STAGE_LABELS.inspect };
    push(inspectActivity);
    setPhase('inspecting', STAGE_LABELS.inspect);
    const inspectDetail = facts.hasProject ? `${facts.fileCount} file${facts.fileCount === 1 ? '' : 's'}` : 'empty workspace';
    progress({ phase: 'inspecting', label: STAGE_LABELS.inspect, detail: inspectDetail, status: 'running' });
    inspectActivity.status = 'done';
    inspectActivity.detail = inspectDetail;
    push({ ...inspectActivity });
    progress({ phase: 'inspecting', label: STAGE_LABELS.inspect, detail: inspectDetail, status: 'done' });

    // The discovered facts + chosen default are handed to the loop as leading
    // context so the model plans against reality, not assumptions.
    workspaceContextBlock = `${renderWorkspaceFacts(facts)}\n- Implementation default: ${defaultImpl.stack} (${defaultImpl.rationale})\nSuggested starting files: ${defaultImpl.files.join(', ') || '(decide from the request)'}`;

    // ── Non-mutation intents answer without touching files ─────────────
    if (!intent.wantsModification) {
        // The agent still has real tools; it just may not write. Give it the
        // loop so it can INSPECT and answer from real workspace data rather
        // than from a guess. Destructive tools are hard-denied for this pass.
        if (intent.kind === 'explain' || intent.kind === 'inspect' || intent.kind === 'execute') {
            const answer = await runReadOnlyAgent(req, taskContext, push, workspaceContextBlock, { setPhase, progress }, providerTarget);
            return {
                ...answer,
                activities,
                planSummary: intent.summary,
            };
        }
        // Plain conversation (greetings, thanks, small talk) does NOT go
        // through the tool loop: forcing workspace inspection on "hi" burns a
        // dozen provider calls to produce a one-sentence reply, and is the
        // reason short chat used to stall with progress and no answer.
        const chatText = await streamPlainReply(req, taskContext, workspaceContextBlock);
        setPhase('completed', STAGE_LABELS.summarize);
        progress({ phase: 'completed', label: STAGE_LABELS.summarize, status: 'done' });
        return {
            success: true,
            appliedCount: 0,
            wasChatOrExplain: true,
            message: chatText,
            chatResponse: chatText,
            activities,
            planSummary: intent.summary,
            stopReason: 'done',
            changedWorkspace: false,
            taskContext,
        };
    }

    // ── Preview vs live ────────────────────────────────────────────────
    // Preview applies into a shadow tree; live applies into the real one via
    // the authoritative workspace actions.
    let preview: PreviewWorkspace | null = null;
    const pinnedFileName = req.requestContext?.fileName ?? req.fileName ?? getActiveEditorContext()?.fileName ?? null;
    const pinnedFileId = req.requestContext?.fileId ?? req.fileId ?? getActiveEditorContext()?.fileId ?? null;
    const deps = req.preview
        ? (preview = createPreviewWorkspace(fileTree, { fileName: pinnedFileName, fileId: pinnedFileId })).deps
        : createExecutorDeps(req.workspace, pinnedFileName, pinnedFileId);

    // Read tools in preview mode must see the shadow tree (it reflects what
    // the agent has already written this run), while writes go through the
    // preview deps.
    const getEffectiveTree = (): FileNode[] =>
        preview ? (preview.getShadowTree() as FileNode[]) : (req.workspace.getFileTree() as FileNode[]);

    const budget = { ...DEFAULT_AGENT_BUDGET, ...(req.budget ?? {}) };

    // ── [3..6] PLAN → EXECUTE TOOLS → READ RESULTS → CONTINUE ───────────
    setPhase('planning', STAGE_LABELS.plan);
    const executeActivity: AgentActivity = { id: makeActivityId('execute'), tool: 'execute', status: 'running', message: STAGE_LABELS.plan };
    push(executeActivity);

    /**
     * Validation runs on whatever the agent actually produced.
     *
     * In live mode that is the real tree. In preview mode the shadow tree is
     * authoritative for the proposal, so validating against the real tree
     * would check the WRONG bytes and report a pass that means nothing.
     */
    const validateDeps = req.preview
        ? { getFileTree: getEffectiveTree, deps, isCancelled: () => Boolean(req.signal?.aborted) }
        : { getFileTree: () => req.workspace.getFileTree() as FileNode[], deps, isCancelled: () => Boolean(req.signal?.aborted) };

    const loop = await runAgentLoop({
        taskContext,
        history: req.history ?? [],
        workspaceContextBlock,
        deps: {
            getFileTree: getEffectiveTree,
            deps,
            // No callback supplied → destructive tools are DENIED by default
            // in `executeTool`. The chat panel supplies an explicit
            // confirmation handler; nothing is ever silently deleted.
            confirmDestructive: req.confirmDestructive
                ? (tool, args) => req.confirmDestructive!(tool, args)
                : undefined,
            isCancelled: () => Boolean(req.signal?.aborted),
            createDirectory: req.preview ? undefined : req.createDirectory,
        },
        signal: req.signal,
        budget,
        model: req.model,
        providerTarget,
        onStatus: (status) => {
            if (status === 'thinking') {
                // Real model round-trip in flight.
                setPhase('executing');
                executeActivity.status = 'running';
                push({ ...executeActivity });
            }
            if (status === 'tool') {
                setPhase('executing');
            }
        },
        onStep: (step) => {
            // A step that actually executed tools moves the task to
            // 'executing'; inspection alone is NOT completion.
            if (step.requested.some(r => r.tool !== 'get_editor_context')) {
                setPhase('executing');
            }
            reportStep(step, push, progress, executeActivity);
        },
        onFileChanged: req.onFileChanged,
    });

    executeActivity.status = 'done';
    push({ ...executeActivity });

    // ── [7] VALIDATE — real diagnostics on files the agent changed ──────
    // ONE row for the whole validation stage: a running row and its settled
    // row must share an id, otherwise the spinner never stops.
    const touchedPaths = loop.taskContext.touchedPaths;
    const validateActivity: AgentActivity = {
        id: makeActivityId('validate'),
        tool: 'check',
        status: touchedPaths.length > 0 ? 'running' : 'done',
        message: STAGE_LABELS.check,
    };
    if (touchedPaths.length > 0) {
        setPhase('validating', STAGE_LABELS.check, `${touchedPaths.length} file(s)`);
        push(validateActivity);
    }
    const validation = await validateChangedFiles(touchedPaths, req.signal, validateDeps);
    for (const v of validation) {
        if (v.isError && v.firstMessage) {
            loop.taskContext = recordValidationFailure(loop.taskContext, v.path, v.firstMessage);
        }
    }
    if (touchedPaths.length > 0) {
        validateActivity.status = 'done';
        push({ ...validateActivity });
        const errorCount = validation.filter(v => v.isError).length;
        progress({
            phase: 'validating',
            label: STAGE_LABELS.check,
            detail: errorCount ? `${errorCount} issue(s)` : `${validation.length} file(s) checked`,
            status: errorCount ? 'error' : 'done',
        });
    }

    // Record recent edits for follow-up context (live applies only).
    if (!req.preview && loop.changedWorkspace) {
        for (const p of loop.taskContext.touchedPaths) {
            recordRecentEdit(p, 'agent edit', 0);
            // Notify UI of file changes for immediate Monaco/explorer sync
            if (req.onFileChanged) {
                try {
                    const tree = getEffectiveTree();
                    const node = findNodeByPath(tree, p);
                    const content = node && node.type === 'file' ? (typeof node.content === 'string' ? node.content : '') : undefined;
                    req.onFileChanged(p, 'created', content);
                } catch {
                    req.onFileChanged(p, 'created');
                }
            }
        }
    }

    const proposedChanges = preview ? preview.getChanges() : undefined;
    const diffs = buildDiffs(loop.taskContext, preview);

    // ── [8] SUMMARIZE — a final user-facing answer is MANDATORY ────────
    setPhase('summarizing', STAGE_LABELS.summarize);
    // Work the model announced but that is still missing from the workspace.
    // Computed against the AUTHORITATIVE tree for this run (shadow tree in
    // preview mode, real tree otherwise) so a proposed-but-not-yet-applied
    // file is not reported as outstanding.
    const remainingPaths = computeRemainingPaths(
        loop.taskContext,
        p => pathExistsInTree(getEffectiveTree(), p),
    );
    loop.taskContext = { ...loop.taskContext, remainingPaths };
    const message = buildFinalResponse(loop, validation, Boolean(proposedChanges?.length), Boolean(req.preview), remainingPaths);

    // ── [9] TERMINAL STATE ─────────────────────────────────────────────
    // 'completed' is only asserted here, AFTER the loop finished and the
    // final response exists. Pending tool work can never be reported as done.
    setPhase(loop.stopReason === 'cancelled' ? 'cancelled' : 'completed', STAGE_LABELS.summarize);
    progress({ phase: 'completed', label: STAGE_LABELS.summarize, status: 'done' });

    return {
        success: loop.success,
        appliedCount: loop.toolCallCount,
        message,
        activities,
        planSummary: intent.summary,
        diffs,
        proposedChanges,
        changedWorkspace: loop.changedWorkspace,
        stopReason: loop.stopReason,
        taskContext: loop.taskContext,
        validation: validation.map(v => ({ path: v.path, isError: v.isError, markers: v.markers.length })),
    };
}

/**
 * Read-only agent pass: the loop runs with real tools, but every mutating
 * tool is denied, so an explanation request cannot modify the workspace even
 * if the model tries.
 */
async function runReadOnlyAgent(
    req: AgentControllerRequest,
    taskContext: AgentTaskContext,
    push: (a: AgentActivity) => void,
    workspaceContextBlock: string,
    hooks: { setPhase: (p: AgentTaskPhase, l?: string, d?: string) => void; progress: (e: { phase: AgentTaskPhase; label: string; detail?: string; tool?: string; status: 'running' | 'done' | 'error' }) => void },
    providerTarget?: ResolvedByokTarget,
): Promise<Omit<AgentControllerResult, 'activities' | 'planSummary'>> {
    const readActivity: AgentActivity = { id: makeActivityId('read'), tool: 'read', status: 'running', message: STAGE_LABELS.read };
    push(readActivity);
    hooks.progress({ phase: 'executing', label: STAGE_LABELS.read, status: 'running' });
    // Use pre-built WorkspaceSnapshot when provided
    const fileTree = req.workspaceSnapshot?.fileTree ?? (req.workspace.getFileTree() as FileNode[]);
    const deps = createExecutorDeps(req.workspace, req.fileName ?? null, req.fileId ?? null);

    const loop = await runAgentLoop({
        taskContext,
        history: req.history ?? [],
        workspaceContextBlock,
        deps: {
            getFileTree: () => fileTree,
            deps,
            // A read-only pass still authorizes destructive tools as DENIED —
            // the gate exists to refuse, and denying is the safe default when
            // the request itself promised no modifications.
            confirmDestructive: () => false,
        },
        signal: req.signal,
        model: req.model,
        providerTarget,
        onStep: (step) => reportStep(step, push, hooks.progress, readActivity),
        onFileChanged: req.onFileChanged,
    });

    // Same id → this REPLACES the running row instead of appending a second
    // one. (Two ids was the original bug: the 'running' row kept spinning
    // forever next to a finished task.)
    readActivity.status = 'done';
    push({ ...readActivity });

    hooks.progress({ phase: 'executing', label: STAGE_LABELS.read, detail: `${loop.taskContext.operations.length} operation(s)`, status: 'done' });

    // ── GUARANTEED FINAL RESPONSE ──────────────────────────────────────
    // An explanation request must always end in real prose. If the model
    // produced none (budget, repeated failure, provider error), the message
    // is built from VERIFIED read results — never invented.
    const fallback = buildReadOnlySummary(loop, fileTree);
    const message = loop.content?.trim() || fallback;
    hooks.setPhase(loop.stopReason === 'cancelled' ? 'cancelled' : 'completed', STAGE_LABELS.summarize);

    return {
        success: loop.success,
        appliedCount: 0,
        wasChatOrExplain: true,
        message,
        chatResponse: message,
        changedWorkspace: false,
        stopReason: loop.stopReason,
        taskContext: loop.taskContext,
    };
}

/**
 * Plain conversational reply (greetings, thanks, small talk).
 *
 * Deliberately does NOT enter the tool loop: "hi" must not trigger workspace
 * inspection and a dozen provider round-trips. It streams one short answer
 * through the existing AIClient and always returns non-empty text.
 */
async function streamPlainReply(
    req: AgentControllerRequest,
    taskContext: AgentTaskContext,
    workspaceContextBlock: string,
): Promise<string> {
    const { streamChat } = await import('./AIClient');
    const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a warm, concise coding assistant inside the Azemax IDE. Reply in 1-2 friendly sentences. Do not mention files, tools, or internal process unless the user asked.' },
        ...(req.history ?? []).slice(-4),
        { role: 'user', content: `${workspaceContextBlock}\n\nUser said: "${req.userMessage}"` },
    ];
    let acc = '';
    try {
        for await (const event of streamChat(messages, { signal: req.signal, task: 'fast_chat', temperature: 0.4, maxTokens: 512 })) {
            if (event.type === 'delta' && event.content) acc += event.content;
            if (event.type === 'error') throw new Error(event.message || 'Chat failed');
        }
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        // A provider failure is NOT a friendly-sounding reply. Throwing lets
        // the caller's typed error path surface an actionable message — the
        // old "I couldn't reach the assistant right now." sentence was
        // presented as a normal answer for the actual failure.
        throw e;
    }
    const cleaned = acc.trim();
    if (cleaned) return cleaned;
    // Deterministic, honest fallback — never an empty assistant turn.
    void taskContext;
    return 'Tell me what you would like to build or change, and I will take care of it.';
}

/** Truthful read-only summary derived only from verified tool results. */
function buildReadOnlySummary(loop: AgentLoopResult, fileTree: FileNode[]): string {
    if (loop.stopReason === 'cancelled') {
        return 'Cancelled — I stopped before finishing. Nothing was changed.';
    }
    if (loop.stopReason === 'error') {
        return `I could not complete the request: ${loop.error ?? 'the assistant request failed'}.`;
    }
    const reads = loop.taskContext.operations.filter(o => o.tool === 'read_file' || o.tool === 'search_files' || o.tool === 'list_files');
    const errors = loop.taskContext.operations.filter(o => o.status === 'error');
    if (errors.length) {
        return `I could not read everything needed to answer that: ${errors[0].detail ?? errors[0].tool} failed.`;
    }
    if (reads.length > 0) {
        return `I inspected the workspace (${fileTree.filter(n => n.id !== 'root').length} top-level item(s)) but did not finish the analysis. Try rephrasing what you would like explained.`;
    }
    return 'I did not get enough information to answer that. Could you be more specific about which file or part you mean?';
}

/**
 * Surface each executed tool as a progress event.
 *
 * Rows are keyed by tool so the same tool re-running updates its row instead
 * of stacking duplicates ("Do not show the same completed status repeatedly").
 */
function reportStep(
    step: AgentStepRecord,
    push: (a: AgentActivity) => void,
    progress: (e: { phase: AgentTaskPhase; label: string; detail?: string; tool?: string; status: 'running' | 'done' | 'error' }) => void,
    current: AgentActivity,
): void {
    for (const call of step.requested) {
        const label = stageLabelForTool(call.tool);
        current.message = label;
        current.detail = call.target || undefined;
        push({ ...current });
        progress({
            phase: 'executing',
            label,
            tool: call.tool,
            ...(call.target ? { detail: call.target } : {}),
            status: call.ok ? 'done' : 'error',
        });
    }
}

/**
 * Real diagnostics over the files the agent actually changed.
 *
 * Validation is a READ operation, so it always runs the real IDE checker
 * (`diagnosticsService`) against whatever tree is authoritative for this run
 * (live workspace, or the preview shadow tree). It never fabricates a pass:
 * a file that cannot be read or checked is reported as unchecked, not clean.
 */
async function validateChangedFiles(
    paths: string[],
    signal: AbortSignal | undefined,
    deps: AgentToolDeps,
): Promise<Array<{ path: string; isError: boolean; markers: Array<{ message: string }>; firstMessage: string | null; checked: boolean }>> {
    const targets = paths.slice(0, 8);
    if (targets.length === 0) return [];
    const { executeTool } = await import('./agentTools');
    // Diagnostics for different files are independent READ operations — run
    // them concurrently instead of paying the sum of latencies sequentially.
    const results = await Promise.all(targets.map(async (p) => {
        if (signal?.aborted) {
            return { path: p, isError: false, markers: [] as Array<{ message: string }>, firstMessage: null, checked: false };
        }
        const res = await executeTool('get_diagnostics', { path: p }, deps);
        if (!res.ok) {
            // Unchecked — NOT a pass. Reported so the summary can say "could
            // not validate" rather than "no errors".
            return { path: p, isError: false, markers: [] as Array<{ message: string }>, firstMessage: null, checked: false };
        }
        const markers = (res.data.markers as Array<{ message?: string }>) ?? [];
        return {
            path: String(res.data.path ?? p),
            isError: Boolean(res.data.isError),
            markers: markers.map(m => ({ message: m.message ?? 'error' })),
            firstMessage: markers.length ? (markers[0].message ?? 'error') : null,
            checked: true,
        };
    }));
    return results;
}

function buildDiffs(
    taskContext: AgentTaskContext,
    preview: PreviewWorkspace | null,
): Array<{ file: string; added: number; removed: number; summary: string }> | undefined {
    if (preview) {
        return preview.getChanges().map(c => {
            const added = c.after ? c.after.split('\n').length : 0;
            const removed = c.before ? c.before.split('\n').length : 0;
            return {
                file: c.path,
                added,
                removed,
                summary: c.kind === 'create' ? `Created · ${added} lines` : `${added} added, ${removed} removed`,
            };
        });
    }
    if (!taskContext.touchedPaths.length) return undefined;
    return taskContext.touchedPaths.map(p => ({ file: p, added: 0, removed: 0, summary: 'Modified' }));
}

/**
 * Compose the FINAL user-facing response.
 *
 * Priority order:
 *   1. The VERIFIED state — what actually happened to the workspace.
 *   2. The model's own summary — but only when the loop actually finished
 *      normally, so a half-finished run is never dressed up as success.
 *
 * The verified state comes FIRST. The model's narrative is a claim; the
 * operation log is a record. Putting the claim in the headline is what made
 * "Created index.html, styles.css and script.js" appear in the chat when
 * only one of those files existed.
 *
 * It never claims a check passed unless the check ran, never claims a file was
 * written unless a write succeeded, and never returns empty.
 */
function buildFinalResponse(
    loop: AgentLoopResult,
    validation: Array<{ path: string; isError: boolean; markers: Array<{ message: string }>; checked?: boolean }>,
    hasProposal: boolean,
    preview: boolean,
    remainingPaths: string[] = [],
): string {
    const changed = [...new Set(loop.taskContext.touchedPaths)];
    const failed = loop.taskContext.operations.filter(o => o.status === 'error');
    const validationErrors = validation.filter(v => v.isError);
    const parts: string[] = [];

    if (loop.stopReason === 'cancelled') {
        parts.push(
            changed.length
                ? `Cancelled. Partial changes may remain in: ${changed.join(', ')}.`
                : 'Cancelled. No changes were made.',
        );
        return parts.join('\n\n');
    }

    if (loop.stopReason === 'error') {
        parts.push(`I couldn't finish this task: ${loop.error ?? 'the assistant request failed'}.`);
        if (changed.length) parts.push(`Changes made before the failure: ${changed.join(', ')}.`);
        else parts.push('No changes were made.');
        return parts.join('\n\n');
    }

    // ---- VERIFIED STATE FIRST ------------------------------------------
    if (hasProposal) {
        parts.push(`Prepared ${changed.length} change${changed.length === 1 ? '' : 's'}. Review below and Accept to apply, or Reject to discard.`);
    } else if (changed.length) {
        parts.push(`${preview ? 'Prepared changes to' : 'Created/updated'}: ${changed.join(', ')}.`);
    } else if (loop.toolCallCount > 0) {
        parts.push('I inspected the workspace and found nothing that needed changing.');
    }

    // The model's own summary, kept as supporting detail — never as the
    // headline, because it may name files that were never created.
    const modelSummary = loop.content?.trim();
    if (loop.stopReason === 'done' && modelSummary) {
        parts.push(modelSummary);
    }

    // Honest validation reporting — never claim a check passed unless it ran.
    if (validationErrors.length) {
        const detail = validationErrors
            .slice(0, 3)
            .map(v => `${v.path}: ${v.markers[0]?.message ?? 'error'}`)
            .join('; ');
        parts.push(`Checks found ${validationErrors.length} issue(s) — ${detail}.`);
    } else if (validation.some(v => !v.checked)) {
        const unchecked = validation.filter(v => !v.checked).map(v => v.path);
        parts.push(`I could not run checks on ${unchecked.join(', ')} — those files are unverified, not error-free.`);
    } else if (validation.length) {
        parts.push(`Diagnostics ran on ${validation.length} file(s) — no errors.`);
    }

    if (failed.length) {
        parts.push(`${failed.length} operation(s) failed: ${failed.slice(0, 2).map(f => `${f.tool} (${f.detail ?? 'error'})`).join(', ')}.`);
    }

    // Work the model ANNOUNCED but that is still absent from the workspace.
    // This is what stops a partial run from reading as a finished one.
    if (remainingPaths.length) {
        parts.push(
            `Not finished — ${remainingPaths.length} file(s) I said I would create do not exist yet: ${remainingPaths.join(', ')}.`,
        );
    }

    if (loop.stopReason === 'approval_required') {
        parts.push('I stopped because that action needs your approval.');
    } else if (loop.stopReason === 'repeated_failure') {
        parts.push('I stopped after the same step failed repeatedly.');
    } else if (loop.stopReason === 'budget_steps' || loop.stopReason === 'budget_tool_calls' || loop.stopReason === 'budget_time') {
        parts.push('I stopped before finishing because I reached my execution budget — the work may be incomplete.');
    }

    // Never end with an empty assistant turn.
    return parts.join('\n\n').trim() || 'I could not produce a summary for this run.';
}

/**
 * Build the ExecutorDeps-compatible surface used by the structured
 * (non-agent) path. Exported for the chat panel's "accept proposal" flow and
 * for tests that exercise the legacy pipeline.
 */
export async function applyActions(
    actions: AIAction[],
    req: AgentControllerRequest,
): Promise<ExecutionResult> {
    const deps = createExecutorDeps(req.workspace, req.fileName ?? null, req.fileId ?? null);
    return executeActionPlan(actions, deps, { language: null });
}