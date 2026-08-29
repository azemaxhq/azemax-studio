/**
 * Agent Controller — Cursor-style orchestrator.
 * Pipeline: Intent → Live Context → Tool Selection → Tool Execution → Validation → Apply → Verify → Response
 * Provider/model independent; delegates to model via semanticPlanner/AIClient, never touches editor directly.
 */

import { getActiveEditorContext } from '../editor/activeEditorStore';
import { captureLiveIDEContext, recordRecentEdit } from '../workspace/liveIDEContext';
import { generateSemanticPlan, type SemanticPlan } from './semanticPlanner';
import { semanticPlanToActions, type AIAction, type ExecutionResult } from './aiToolExecutor';
import { createToolRegistry } from './toolRegistry';
import { createExecutorDeps, type WorkspaceBridgeActions } from '../editor/workspaceBridge';
import type { FileNode } from '../../utils/mockFileSystem';
import type { ChatMessage } from './types';
import { AIRequestStore } from './aiRequestStore';

export type AgentToolStatus = 'running' | 'done' | 'error';
export interface AgentActivity {
    id: string;
    tool: string;
    status: AgentToolStatus;
    message: string;
    path?: string;
    detail?: string;
}

export interface AgentControllerRequest {
    userMessage: string;
    workspace: WorkspaceBridgeActions;
    fileName: string | null;
    fileId?: string | null;
    history?: ChatMessage[];
    signal?: AbortSignal;
    onActivity?: (activity: AgentActivity) => void;
}

export interface AgentControllerResult extends ExecutionResult {
    wasChatOrExplain?: boolean;
    chatResponse?: string;
    activities: AgentActivity[];
    planSummary: string;
    diffs?: Array<{ file: string; added: number; removed: number; summary: string }>;
}

function makeActivity(tool: string, status: AgentToolStatus, message: string, path?: string): AgentActivity {
    return { id: `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, tool, status, message, path };
}
function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms`)), ms);
        const onAbort = () => { clearTimeout(timer); reject(new DOMException('The operation was aborted.', 'AbortError')); };
        if (signal) {
            if (signal.aborted) { clearTimeout(timer); reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        promise.then(v => { clearTimeout(timer); if(signal) signal.removeEventListener('abort', onAbort); resolve(v); }, e => { clearTimeout(timer); if(signal) signal.removeEventListener('abort', onAbort); reject(e); });
    });
}

const READ_TYPES = new Set(['read_file', 'search_files', 'list_files', 'get_diagnostics', 'get_editor_context', 'open_file', 'run_code']);

export async function runAgentController(req: AgentControllerRequest): Promise<AgentControllerResult> {
    const activities: AgentActivity[] = [];
    const push = (a: AgentActivity) => {
        const idx = activities.findIndex(x => x.id === a.id);
        if (idx >= 0) activities[idx] = a;
        else activities.push(a);
        req.onActivity?.(a);
    };

    // [1] INTENT + [2] LIVE CONTEXT (fresh Monaco + workspace)
    const live = captureLiveIDEContext(req.workspace.getFileTree());
    const fileName = req.fileName ?? live.fileName ?? '';
    const fileContent = live.code ?? '';
    const language = live.language ?? 'plaintext';

    // [1] Intent detection (semantic planner) — single refined status, no duplicate
    const interpretingId = `interpret-${Date.now()}`;
    const interpreting: AgentActivity = { id: interpretingId, tool: 'interpret', status: 'running', message: 'Understanding request…', path: fileName || undefined };
    push(interpreting);
    AIRequestStore.updateRequest(AIRequestStore.getActiveRequestForOperation('chat')?.id ?? '', 'thinking');

    let plan: SemanticPlan | null = null;
    let fallbackEditActions: AIAction[] | null = null;
    try {
        plan = await generateSemanticPlan(req.userMessage, getActiveEditorContext(), live.fileTreeString, req.history ?? [], req.signal);
    } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') throw e;
    }
    // Refined, non-duplicate, human-friendly summary — no "Interpreted:" prefix, no truncation
    if (plan) {
        // Keep it minimal premium: show file context, not raw summary dump
        const isSingleLineComment = plan.actions.length === 1 && plan.actions[0].type === 'add_comments' && (plan.actions[0].payload?.comments?.length === 1);
        if (isSingleLineComment) {
            const line = (plan.actions[0].payload?.comments?.[0] as { line?: number })?.line;
            interpreting.message = line ? `Add comment → line ${line}` : `Add comment → ${fileName || 'file'}`;
        } else if (plan.analysis.summary) {
            // Clean summary: first sentence, no ellipsis duplication
            const clean = plan.analysis.summary.split('.')[0].trim().slice(0, 60);
            interpreting.message = clean || 'Ready';
        } else {
            interpreting.message = 'Ready';
        }
    } else {
        interpreting.message = 'Ready';
    }
    interpreting.status = 'done';
    push({ ...interpreting });

    if (!plan) {
        return { success: false, appliedCount: 0, message: 'Could not interpret the request safely — no changes were made.', activities, planSummary: '' };
    }

    let wantsMutation = plan.analysis.wantsModification && !plan.actions.every(a => ['chat', 'explain'].includes(a.type));
    if (!wantsMutation) {
        // Chat/explain path — but don't trust it blindly. If we have an active file with code,
        // the planner may have misclassified an edit like "Add comments to this code" as chat.
        // Use a second, edit-focused model pass (no hard-coded keywords) to verify. If that
        // pass produces concrete edit actions, we treat the request as an edit and continue
        // to the tool execution path instead of returning chat. This fixes the "edit in chat" bug
        // without any if(message.includes(...)) hard-coding.
        // Only double-check for non-trivial, longer messages to avoid extra cost on greetings/short chat
        const msgTrim = req.userMessage.trim();
        if (fileName && fileContent && fileContent.trim().length > 0 && msgTrim.length > 15) {
            // Silent double-check — no extra card, just verify without spamming UI
            try {
                const { generateConstrainedActions } = await import('./editPipeline');
                const ctx = getActiveEditorContext();
                // Synthetic edit plan — lets the model decide if an edit is actually warranted
                const syntheticPlan: SemanticPlan = {
                    analysis: { operation: 'edit', wantsModification: true, wantsExplanation: false, summary: plan.analysis.summary },
                    actions: [{ type: 'refactor', target: { filePath: fileName } }],
                    globalConstraints: plan.globalConstraints,
                };
                const fallbackActions = await generateConstrainedActions(
                    req.userMessage,
                    syntheticPlan,
                    fileName,
                    language,
                    fileContent,
                    ctx?.selectionText ?? null,
                    ctx?.selection ?? null,
                    req.history ?? [],
                    req.signal,
                );
                if (fallbackActions && fallbackActions.length > 0) {
                    // Model confirmed this is an edit — continue to edit flow
                    plan = { ...plan, analysis: { ...plan.analysis, operation: 'edit', wantsModification: true } };
                    fallbackEditActions = fallbackActions;
                    wantsMutation = true;
                } else {
                    return {
                        success: true,
                        appliedCount: 0,
                        wasChatOrExplain: true,
                        message: plan.responseMessage || plan.analysis.summary || '',
                        chatResponse: plan.responseMessage,
                        activities,
                        planSummary: plan.analysis.summary,
                    };
                }
            } catch {
                return {
                    success: true,
                    appliedCount: 0,
                    wasChatOrExplain: true,
                    message: plan.responseMessage || plan.analysis.summary || '',
                    chatResponse: plan.responseMessage,
                    activities,
                    planSummary: plan.analysis.summary,
                };
            }
        } else {
            return {
                success: true,
                appliedCount: 0,
                wasChatOrExplain: true,
                message: plan.responseMessage || plan.analysis.summary || '',
                chatResponse: plan.responseMessage,
                activities,
                planSummary: plan.analysis.summary,
            };
        }
    }

    // [3] TOOL SELECTION: separate reads vs mutations
    const readActions = plan.actions.filter(a => READ_TYPES.has(a.type));
    const mutationCandidates = plan.actions.filter(a => !READ_TYPES.has(a.type));

    // [4] TOOL EXECUTION for reads (local, no LLM)
    let readEnrichment = '';
    if (readActions.length > 0) {
        const maybeSetActive = (req.workspace as unknown as { setActiveFile?: (f: FileNode) => void }).setActiveFile;
        const registry = createToolRegistry({
            getFileTree: req.workspace.getFileTree,
            getActiveFile: () => {
                const ctx = getActiveEditorContext();
                if (!ctx) return null;
                const tree = req.workspace.getFileTree();
                const walk = (nodes: FileNode[]): FileNode | null => {
                    for (const n of nodes) {
                        if (n.name === ctx.fileName) return n;
                        if (n.children) { const f = walk(n.children); if (f) return f; }
                    }
                    return null;
                };
                return walk(tree);
            },
            createFile: req.workspace.createFile as unknown as ToolRegistryDeps['createFile'],
            deleteNode: req.workspace.deleteNode,
            updateFileContent: req.workspace.updateFileContent as unknown as ToolRegistryDeps['updateFileContent'],
            setActiveFile: maybeSetActive ? (node: FileNode) => maybeSetActive(node) : undefined,
        } as unknown as import('./toolRegistry').ToolRegistryDeps);

        for (const ra of readActions) {
            const toolName = ra.type as import('./toolRegistry').ToolName;
            const args: Record<string, unknown> = { ...(ra.payload as Record<string, unknown>), ...(ra.target as Record<string, unknown>) };
            // normalize: payload.path / target.filePath -> path, payload.query -> query
            if (!args.path && (ra.target?.filePath || (ra.payload as { path?: string })?.path)) args.path = ra.target?.filePath ?? (ra.payload as { path?: string })?.path;
            if (!args.query && (ra.payload as { query?: string })?.query) args.query = (ra.payload as { query?: string })?.query;
            const act = makeActivity(toolName, 'running', `Reading ${String(args.path ?? args.query ?? '')}…`, String(args.path ?? ''));
            push(act);
            try {
                if (req.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
                const res = await withTimeout(registry.execute(toolName, args), 12000, req.signal);
                act.status = res.ok ? 'done' : 'error';
                act.message = res.ok ? `Read ${String(args.path ?? args.query)}` : `Failed: ${res.error}`;
                act.detail = res.ok ? JSON.stringify(res.result).slice(0, 600) : res.error;
                push({ ...act });
                if (res.ok && res.result) {
                    readEnrichment += `\n[Tool ${toolName} ${JSON.stringify(args)}]\n${JSON.stringify(res.result).slice(0, 4000)}\n`;
                }
            } catch (e: any) {
                if (e?.name === 'AbortError') {
                    act.status = 'error';
                    act.message = `Cancelled ${toolName}`;
                    (act as any).detail = 'Request cancelled';
                } else if (String(e?.message || '').includes('timed out')) {
                    act.status = 'error';
                    act.message = `Timeout ${toolName}`;
                    (act as any).detail = e.message;
                } else {
                    act.status = 'error';
                    act.message = `Error ${toolName}`;
                    (act as any).detail = e?.message ?? String(e);
                }
                push({ ...act });
            }
        }
    }

    // [3b] Convert mutation intents to concrete AIAction[] — reuse fallback if we already double-checked
    let actions: AIAction[] | null = null;
    if (fallbackEditActions && fallbackEditActions.length > 0) {
        actions = fallbackEditActions;
    } else {
        actions = semanticPlanToActions({ ...plan, actions: mutationCandidates as typeof plan.actions }, fileName, fileContent ? fileContent.split('\n') : null);
    }

    // If no concrete ops yet, do constrained generation enriched with read results
    if (!actions || actions.length === 0) {
        const generating = makeActivity('generate', 'running', 'Planning edits…');
        push(generating);
        const { generateConstrainedActions } = await import('./editPipeline');
        const ctx = getActiveEditorContext();
        const enrichedPlan: SemanticPlan = { ...plan, responseMessage: (plan.responseMessage ?? '') + readEnrichment };
        // inject enrichment via history trick: add tool results as user message context
        const enrichedHistory = [...(req.history ?? [])];
        if (readEnrichment) enrichedHistory.push({ role: 'user', content: `Tool results:${readEnrichment}` } as ChatMessage);
        actions = await generateConstrainedActions(
            req.userMessage,
            enrichedPlan,
            fileName,
            language,
            fileContent,
            ctx?.selectionText ?? null,
            ctx?.selection ?? null,
            enrichedHistory,
            req.signal,
        );
        generating.status = actions && actions.length ? 'done' : 'error';
        generating.message = actions && actions.length ? `Planned ${actions.length} edit(s)` : 'No safe edits generated';
        push({ ...generating });
    }

    if (!actions || actions.length === 0) {
        return {
            success: false,
            appliedCount: 0,
            message: `Understood "${plan.analysis.summary}" but could not build a safe edit for the current file. No changes were made.`,
            activities,
            planSummary: plan.analysis.summary,
        };
    }

    // Filter out read-only actions that slipped through (they are already handled)
    actions = actions.filter(a => !READ_TYPES.has((a as { action: string }).action));

    if (actions.length === 0) {
        return { success: true, appliedCount: 0, wasChatOrExplain: true, message: 'Gathered context.', chatResponse: readEnrichment.slice(0, 2000), activities, planSummary: plan.analysis.summary };
    }

    // [5] VALIDATION + [6] APPLY + [7] VERIFY — refined, single card per phase
    // Build a human-friendly label for the apply step
    const firstAction = actions[0] as { action: string; file?: string; path?: string; comments?: { line?: number }[] };
    let applyLabel = `Updating ${fileName || 'file'}…`;
    if (firstAction.action === 'add_comments' && firstAction.comments?.length === 1 && firstAction.comments[0].line) {
        applyLabel = `Adding comment to line ${firstAction.comments[0].line}…`;
    } else if (firstAction.action === 'add_comments') {
        applyLabel = `Adding ${firstAction.comments?.length ?? actions.length} comment(s)…`;
    } else if (firstAction.action === 'create_file') {
        applyLabel = `Creating ${firstAction.path}…`;
    } else if (firstAction.action === 'rename_file') {
        applyLabel = `Renaming file…`;
    }
    const applying = makeActivity('apply', 'running', applyLabel);
    push(applying);
    const deps = createExecutorDeps(req.workspace, fileName || null, req.fileId ?? getActiveEditorContext()?.fileId ?? null);
    const snapshotForEdit = fileContent ? { filePath: fileName, content: fileContent, lines: fileContent.split('\n'), timestamp: Date.now() } as import('./editEngine').FileSnapshot : null;
    const snapshotMap = new Map<string, import('./editEngine').FileSnapshot>();
    if (snapshotForEdit) snapshotMap.set(snapshotForEdit.filePath, snapshotForEdit);

    const { executeActionPlan } = await import('./aiToolExecutor');
    const result = await executeActionPlan(actions as AIAction[], deps as import('./aiToolExecutor').ExecutorDeps, { language, snapshot: snapshotForEdit, snapshotMap });

    applying.status = result.success ? 'done' : 'error';
    if (result.success) {
        if (firstAction.action === 'add_comments' && result.appliedCount) {
            const line = firstAction.comments?.[0]?.line;
            applying.message = line ? `Added comment to line ${line}` : `Added ${result.appliedCount} comment(s)`;
        } else {
            applying.message = result.appliedCount ? `Updated ${fileName || 'file'}` : 'No changes needed';
        }
    } else {
        applying.message = `Apply failed`;
    }
    // Keep detail for tooltip/debug but don't spam list with long text
    applying.detail = result.success ? undefined : result.message.slice(0, 200);
    push({ ...applying });

    // Generate compact diff summary for artifact UI
    let diffs: Array<{ file: string; added: number; removed: number; summary: string }> | undefined;
    if (result.success && result.appliedCount > 0) {
        const newContent = deps.getFileContent(fileName) ?? '';
        if (newContent && fileContent) {
            const origSet = new Set(fileContent.split('\n').map(l => l.trim()).filter(Boolean));
            const newLines = newContent.split('\n').map(l => l.trim()).filter(Boolean);
            const newSet = new Set(newLines);
            let added = 0, removed = 0;
            for (const l of newLines) if (!origSet.has(l)) added++;
            for (const l of origSet) if (!newSet.has(l)) removed++;
            // For comment-only, added is number of comments
            if (added === 0 && firstAction.action === 'add_comments') added = firstAction.comments?.length ?? result.appliedCount;
            diffs = [{ file: fileName, added, removed, summary: `${added} added, ${removed} removed` }];
        } else if (firstAction.action === 'create_file' && firstAction.path) {
            const createdContent = deps.getFileContent(firstAction.path) ?? '';
            const lines = createdContent ? createdContent.split('\n').length : 0;
            diffs = [{ file: firstAction.path as string, added: lines, removed: 0, summary: `Created · ${lines} lines` }];
        }
    }

    // Record recent edits for live context history
    if (result.success && result.appliedCount > 0) {
        for (const a of actions) {
            const p = (a as { path?: string; file?: string }).path ?? (a as { file?: string }).file ?? fileName;
            if (p) recordRecentEdit(p, (a as { action: string }).action, result.appliedCount);
        }
    }

    // [8] Natural response is result.message (brief, verified)
    return { ...result, activities, planSummary: plan.analysis.summary, diffs };
}

type ToolRegistryDeps = import('./toolRegistry').ToolRegistryDeps;
