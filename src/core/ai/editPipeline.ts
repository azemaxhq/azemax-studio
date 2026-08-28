/**
 * Edit Pipeline — one authoritative entry point for natural-language editing.
 *
 *   runEditPipeline(request, deps) performs:
 *     [1] INTENT     — semantic planner infers operation + structured plan (AI)
 *     [2] CONTEXT    — fresh Monaco/workspace state captured at request time
 *     [3] ACTIONS    — plan → validated AIAction[] with anchors; constrained AI
 *                      call ONLY when the plan lacks concrete operations
 *     [4] EXECUTE    — aiToolExecutor.executeActionPlan (resolve → compose →
 *                      validate → atomic apply → verify)
 *
 * Every editor mutation flows through here. No feature-specific parsing,
 * no hard-coded phrases, no legacy fallbacks.
 */

import { getActiveEditorContext } from '../editor/activeEditorStore';
import { buildWorkspaceSnapshot } from '../workspace/workspaceContext';
import type { FileNode } from '../../utils/mockFileSystem';
import type { ChatMessage } from './types';
import {
    generateSemanticPlan,
    parseSemanticPlan,
    type SemanticPlan,
} from './semanticPlanner';
import {
    executeActionPlan,
    normalizeAIResponseToActions,
    semanticPlanToActions,
    type AIAction,
    type ExecutionResult,
} from './aiToolExecutor';
import { captureSnapshot, createExecutorDeps, type WorkspaceBridgeActions } from '../editor/workspaceBridge';

export interface EditPipelineRequest {
    /** The user's natural-language request */
    userMessage: string;
    /** Project tree mutators/readers (from ProjectContext) */
    workspace: WorkspaceBridgeActions;
    /** File the request targets (pinned at request time) */
    fileName: string | null;
    fileId?: string | null;
    /** Recent conversation for context-aware resolution */
    history?: ChatMessage[];
    /** Abort signal for cancellation */
    signal?: AbortSignal;
}

export interface EditPipelineResult extends ExecutionResult {
    /** True when the request was chat/explain — no file was touched */
    wasChatOrExplain?: boolean;
    /** Natural-language answer when the request resolved to chat/explain */
    chatResponse?: string;
}

const CHAT_ACTION_TYPES = new Set(['chat', 'explain']);

/**
 * Run the full natural-language editing pipeline.
 * Returns an accurate result describing exactly what happened.
 */
export async function runEditPipeline(request: EditPipelineRequest): Promise<EditPipelineResult> {
    const ctx = getActiveEditorContext();
    const snapshot = buildWorkspaceSnapshot(ctx, request.workspace.getFileTree() as FileNode[]);

    const fileContent = snapshot.code ?? '';
    const fileName = request.fileName ?? snapshot.fileName ?? '';
    const language = snapshot.language ?? 'plaintext';

    // [1] INTENT — model decides what the user wants against fresh context
    const plan = await generateSemanticPlan(
        request.userMessage,
        ctx,
        snapshot.fileTreeString,
        request.history ?? [],
        request.signal,
    );

    if (!plan) {
        return {
            success: false,
            appliedCount: 0,
            message: 'Could not interpret the request safely — no changes were made.',
        };
    }

    const wantsMutation = plan.analysis.wantsModification
        && !plan.actions.every(a => CHAT_ACTION_TYPES.has(a.type));

    if (!wantsMutation) {
        return {
            success: true,
            appliedCount: 0,
            wasChatOrExplain: true,
            message: plan.responseMessage || plan.analysis.summary || '',
            chatResponse: plan.responseMessage || undefined,
        };
    }

    // [3] ACTIONS — convert plan to concrete ops enriched with anchors
    const snapLines = fileContent ? fileContent.split('\n') : null;
    let actions = semanticPlanToActions(plan, fileName, snapLines);

    // Constrained second call ONLY when the plan wants edits but produced no
    // concrete operations (e.g., refactor/fix without content).
    if (!actions || actions.length === 0) {
        actions = await generateConstrainedActions(
            request.userMessage,
            plan,
            fileName,
            language,
            fileContent,
            ctx?.selectionText ?? null,
            ctx?.selection ?? null,
            request.history ?? [],
            request.signal,
        );
    }

    if (!actions || actions.length === 0) {
        return {
            success: false,
            appliedCount: 0,
            message: `Understood "${plan.analysis.summary}" but could not build a safe edit for the current file. No changes were made.`,
        };
    }

    // [4] EXECUTE — atomic resolve→validate→apply→verify with rollback
    const deps = createExecutorDeps(request.workspace, fileName || null, request.fileId ?? ctx?.fileId ?? null);
    const snapshotForEdit = captureSnapshot(fileName, fileContent || (ctx?.code ?? null));
    const snapshotMap = new Map<string, import('./editEngine').FileSnapshot>();
    if (snapshotForEdit) snapshotMap.set(snapshotForEdit.filePath, snapshotForEdit);

    return executeActionPlan(actions as AIAction[], deps, {
        language,
        snapshot: snapshotForEdit,
        snapshotMap,
    });
}

/**
 * Constrained generation: ask the model for a JSON action plan given the
 * already-inferred semantic intent. Produces ONLY concrete operations.
 * Exported for callers that already hold a SemanticPlan (chat panel).
 */
export async function generateConstrainedActions(
    userMessage: string,
    plan: SemanticPlan,
    fileName: string,
    language: string,
    fileContent: string,
    selectionText: string | null,
    selectionRange: { startLine: number; endLine: number } | null,
    history: ChatMessage[],
    signal?: AbortSignal,
): Promise<AIAction[] | null> {
    const constraintDesc = [
        plan.globalConstraints?.preserveOutput ? 'preserve the existing output' : '',
        plan.globalConstraints?.preserveBehavior ? 'preserve existing behavior — do not change functionality' : '',
        plan.actions[0]?.constraints?.preserve?.join('; ') || '',
        plan.actions[0]?.constraints?.scopeDescription || '',
    ].filter(Boolean).join('; ');

    const isSelectionScope = plan.actions[0]?.target?.scope === 'selection' && !!selectionText;

    const lineNumbered = fileContent
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`)
        .join('\n')
        .slice(0, 12000);

    const systemPrompt = `You are a precise code-edit planner for ${language}. Produce a JSON action plan implementing the user's request against the CURRENT file content.

RULES:
- Output ONLY JSON: {"actions":[...]} with types: add_comments, remove_comments, insert_code, replace_code, delete_code.
- Comment ops are metadata only: {"type":"add_comments","payload":{"comments":[{"line":N,"text":"...","mode":"add"|"replace"|"remove","anchor":"<exact current line N text>"}]}} — never source code, never whole files.
- Line/range ops: {"type":"replace_code","payload":{"startLine":N,"endLine":M,"content":"new lines","anchor":"<exact current line N text>"}}. Content replaces the range in place — NEVER duplicate existing lines.
- All line numbers MUST match the numbered CURRENT content below. Include "anchor" for every op.
- Use the smallest sufficient edit. Whole-file rewrites are forbidden.
- Constraints: ${constraintDesc || 'none'}
- If the request cannot be mapped to safe concrete operations, output {"actions":[]}.

Respond ONLY with the JSON.`;

    const userPrompt = [
        `File: ${fileName} (${language})`,
        isSelectionScope && selectionRange
            ? `Target selection: lines ${selectionRange.startLine}-${selectionRange.endLine}\n\`\`\`${language}\n${(selectionText ?? '').slice(0, 6000)}\n\`\`\``
            : '',
        `CURRENT content:\n\`\`\`${language}\n${lineNumbered}\n\`\`\``,
        `User request: "${userMessage}"`,
        `Semantic intent: ${plan.analysis.summary}`,
        ``,
        `Return ONLY the JSON action plan.`,
    ].filter(Boolean).join('\n\n');

    try {
        const { sendChat } = await import('./AIClient');
        const raw = await sendChat(
            [
                { role: 'system', content: systemPrompt },
                ...(history.length > 0 ? history.slice(-4) : []),
                { role: 'user', content: userPrompt },
            ],
            { signal, task: 'simple_edit', temperature: 0.1, maxTokens: 1200 },
        );
        if (!raw) return null;

        // Parse tolerant of fences/wrappers — canonical operations first
        const actions = normalizeAIResponseToActions(raw, fileName);
        if (actions) return actions;

        // Model may have echoed a semantic plan shape — convert it
        const retryPlan = parseSemanticPlan(raw);
        if (retryPlan) return semanticPlanToActions(retryPlan, fileName, fileContent.split('\n'));

        return null;
    } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        return null;
    }
}
