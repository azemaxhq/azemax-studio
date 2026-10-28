/**
 * Agent Loop — the real provider→tool orchestration cycle.
 *
 * THIS is what "Agent mode" runs. Previously the agent was a single-shot
 * pipeline: one planner call, a fixed set of read tools, one generation call,
 * one apply, done. There was no cycle, so the model could never see a tool
 * result and decide what to do next — which is precisely why the product
 * answered ordinary requests with a question instead of doing the work.
 *
 * The loop, per step:
 *   1. send request + relevant context + tool definitions to the provider
 *   2. receive the model response (via the existing AIClient)
 *   3. identify supported STRUCTURED tool calls (native `tool_calls`)
 *   4. validate every call (schema + path + permission), in application code
 *   5. execute the real tools (real filesystem operations)
 *   6. capture real results and errors
 *   7. append the assistant turn WITH `tool_calls` and one `tool` message per
 *      result back into the conversation
 *   8. go to 1 with the updated context
 * until the model stops requesting tools, or a stopping condition fires.
 *
 * STOPPING CONDITIONS (bounded by construction — see DEFAULT_AGENT_BUDGET):
 *   - model returns no tool calls (task considered done)
 *   - step / tool-call / wall-clock budget exhausted
 *   - cancellation (user pressed stop)
 *   - the same tool call with the same arguments failed N times in a row
 *   - the model requested a destructive tool that was not approved
 *
 * Honest reporting: the loop returns the tools that ACTUALLY ran and their
 * ACTUAL results. A file is only reported as created if the filesystem
 * operation succeeded.
 */

import { sendChatResult } from './AIClient';
import type { ResolvedByokTarget } from './byokTypes';
import { executeTool, parseToolArguments, toolSchema, toolDefinitions, type AgentToolDeps, type ToolResult } from './agentTools';
import { isAbortError } from './AIAbortController';
import {
    AGENT_SYSTEM_PROMPT,
    DEFAULT_AGENT_BUDGET,
    buildAgentMessages,
    computeRemainingPaths,
    finishTask,
    pathExistsInTree,
    recordAnnouncedPaths,
    recordOperation,
    recordValidationFailure,
    type AgentBudget,
    type AgentTaskContext,
} from './agentTaskContext';
import type { ChatMessage } from './types';
import { AIError, AI_ERROR_CODES } from './AIError';

/** Read-only tools have no side-effect ordering concerns and may run concurrently. */
const READ_TOOLS = new Set(['list_files', 'read_file', 'search_files', 'get_file_info', 'get_diagnostics', 'get_editor_context']);

export interface AgentStepRecord {
    step: number;
    /** Tools the model requested this step. */
    requested: Array<{ tool: string; target: string; ok: boolean; error?: string }>;
    /** Model's visible text this step (usually empty when tools are called). */
    content: string;
}

export interface AgentLoopResult {
    /** Final assistant message. */
    content: string;
    success: boolean;
    /** Real tool executions performed, in order. */
    steps: AgentStepRecord[];
    toolCallCount: number;
    /** Populated task context including operations actually performed. */
    taskContext: AgentTaskContext;
    /** Why the loop stopped. */
    stopReason: 'done' | 'budget_steps' | 'budget_tool_calls' | 'budget_time' | 'cancelled' | 'repeated_failure' | 'approval_required' | 'error';
    /** True when at least one mutating tool actually succeeded. */
    changedWorkspace: boolean;
    error?: string;
}

export interface AgentLoopRequest {
    taskContext: AgentTaskContext;
    /** Bounded conversation tail (not the whole transcript). */
    history: ChatMessage[];
    /** Discovered workspace facts + chosen implementation default. */
    workspaceContextBlock?: string;
    /** Live tool dependencies (real workspace). */
    deps: AgentToolDeps;
    signal?: AbortSignal;
    budget?: Partial<AgentBudget>;
    /** Requested model. Falls back to AIClient's default routing. */
    model?: string;
    /**
     * A pinned BYOK provider target.
     *
     * Resolved ONCE by the controller before the loop starts and reused for
     * every iteration, so changing the provider/model in settings mid-task
     * cannot switch the running task to a different provider or credential.
     */
    providerTarget?: ResolvedByokTarget;
    /** Optional per-step progress callback (drives the UI activity card). */
    onStep?: (step: AgentStepRecord) => void;
    /** Optional status callback for richer UI. */
    onStatus?: (status: 'thinking' | 'tool' | 'verifying' | 'done') => void;
    /** Callback when a file is created or updated during tool execution. */
    onFileChanged?: (path: string, action: 'created' | 'updated' | 'deleted', content?: string) => void;
}

/** Tools whose arguments carry file content (used for duplicate detection). */
const WRITE_TOOLS = new Set(['create_file', 'write_file', 'replace_range', 'insert_text']);

/** Serialize a tool result for the `tool` message content. */
function serializeToolResult(result: ToolResult, tool: string): string {
    if (!result.ok) {
        // The model must be able to RECOVER: include what failed and, where we
        // know it, how to proceed — but never a fabricated success.
        return JSON.stringify({ ok: false, tool, error: result.error ?? 'Tool failed', requiresApproval: Boolean(result.requiresApproval) });
    }
    return JSON.stringify({ ok: true, tool, ...result.data });
}

/** Bound a single tool result so one huge file cannot blow up the context. */
function boundResult(content: string, max: number): string {
    if (content.length <= max) return content;
    return `${content.slice(0, max)}\n…[truncated ${content.length - max} chars]`;
}

/**
 * Run the agent until it stops requesting tools or a budget is exhausted.
 *
 * Every model call goes through `AIClient.sendChatResult`, so the existing
 * provider abstraction, fallback chain, quota accounting, error typing and
 * telemetry all apply unchanged.
 */
export async function runAgentLoop(req: AgentLoopRequest): Promise<AgentLoopResult> {
    const budget: AgentBudget = { ...DEFAULT_AGENT_BUDGET, ...(req.budget ?? {}) };
    const definitions = toolDefinitions();
    const steps: AgentStepRecord[] = [];
    let taskContext = req.taskContext;
    let toolCallCount = 0;
    let changedWorkspace = false;
    let content = '';

    const startedAt = Date.now();
    const deadline = startedAt + budget.timeoutMs;

    /**
     * Cheap content hash for duplicate-write detection. Not a security
     * primitive — it only needs to distinguish "the same bytes again".
     */
    const fingerprint = (s: string): string => {
        let h1 = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h1 ^= s.charCodeAt(i);
            h1 = Math.imul(h1, 0x01000193);
        }
        return `${s.length}:${(h1 >>> 0).toString(36)}`;
    };

    /**
     * Retry configuration for transient provider failures.
     */
    const RETRY_CONFIG = {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitterFactor: 0.3,
    };

    /**
     * Determines if an error is a transient provider failure that warrants retry.
     * Transient errors: network timeouts, 5xx errors, rate limits, temporary unavailability.
     * Permanent errors: auth failures, invalid requests, exhausted quotas, unsupported models.
     */
    function isTransientProviderError(err: unknown): boolean {
        if (err instanceof AIError) {
            const code = err.code as string;
            // Retryable AIError codes
            const retryableCodes = new Set<string>([
                AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
                AI_ERROR_CODES.AI_PROVIDER_TIMEOUT,
                AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED,
                AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
                AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST, // 404/410 for model not found
            ]);
            if (retryableCodes.has(code)) return true;
            // Explicitly non-retryable
            const nonRetryableCodes = new Set<string>([
                AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
                AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
                AI_ERROR_CODES.AI_INVALID_RESPONSE,
                AI_ERROR_CODES.AI_REQUEST_ABORTED,
            ]);
            if (nonRetryableCodes.has(code)) return false;
        }
        // Network-level errors
        if (err instanceof Error) {
            const msg = err.message.toLowerCase();
            if (/network|fetch failed|econnrefused|etimedout|enotfound|dns|socket/i.test(msg)) return true;
        }
        return false;
    }

    /**
     * Executes a function with exponential backoff retry for transient failures.
     * Preserves the original error if all retries exhausted.
     */
    async function withRetry<T>(
        fn: () => Promise<T>,
        signal?: AbortSignal
    ): Promise<T> {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            try {
                return await fn();
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                // Don't retry on abort
                if (isAbortError(err)) throw err;
                // Check if we should retry
                const isLastAttempt = attempt === RETRY_CONFIG.maxRetries;
                const isTransient = isTransientProviderError(err);
                if (isLastAttempt || !isTransient) {
                    throw lastError;
                }
                // Exponential backoff with jitter
                const baseDelay = Math.min(
                    RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
                    RETRY_CONFIG.maxDelayMs
                );
                const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
                const delayMs = Math.floor(baseDelay + jitter);
                req.onStatus?.('tool'); // signal retry in progress
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
        throw lastError;
    }

    // Seed the conversation: system prompt + bounded task context + history tail.
    const messages: ChatMessage[] = buildAgentMessages({
        systemPrompt: AGENT_SYSTEM_PROMPT,
        taskContext,
        history: req.history,
        workspaceContextBlock: req.workspaceContextBlock,
        userMessage: req.taskContext.followUps.length
            ? req.taskContext.followUps[req.taskContext.followUps.length - 1]
            : req.taskContext.objective,
    });

    let totalToolResultChars = 0;
    // Signature of the most recent failing call, to detect a stuck loop.
    let lastFailureSignature: string | null = null;
    let repeatFailureCount = 0;
    // Fingerprints of writes already performed, so a model that re-requests an
    // identical write in a later step gets an idempotent no-op instead of a
    // duplicate file write. Reset when the workspace changes underneath us.
    const writeFingerprints = new Set<string>();
    let lastTreeSize = -1;
    /**
     * Last NON-EMPTY assistant text seen.
     *
     * A tool-call turn legitimately carries no text, so `content` is overwritten
     * on every step. Keeping the last substantive text means an interrupted run
     * still has something truthful to report instead of an empty turn.
     */
    let lastModelContent = '';
    /**
     * Consecutive retryable model-call failures. `sendChatResult` returns
     * provider errors as a union instead of throwing, so `withRetry` above
     * cannot see them. This counter gives those verdicts the same bounded
     * retry treatment: enough attempts to ride out a transient 5xx/rate limit,
     * never an unbounded loop.
     */
    let transientModelFailures = 0;

    const finish = (
        stopReason: AgentLoopResult['stopReason'],
        success: boolean,
        error?: string,
    ): AgentLoopResult => {
        // A run that FAILED an operation is not a successful completion, no
        // matter how the run ended. Reporting `success: true` alongside a
        // failed operation is exactly the "the AI says it did the work but
        // it did not" symptom, in its purest form.
        const hasFailure = taskContext.operations.some(o => o.status === 'error');
        const effectiveSuccess = success && !hasFailure;
        // Build a detailed error message that includes completed operations
        let detailedError = error;
        if (!effectiveSuccess && (error || hasFailure)) {
            const completedOps = taskContext.operations
                .filter(o => o.status === 'ok')
                .map(o => `${o.tool}:${o.target}`)
                .join(', ');
            const failedOps = taskContext.operations
                .filter(o => o.status === 'error')
                .map(o => `${o.tool}:${o.target} (${o.detail ?? 'failed'})`)
                .join('; ');
            const parts: string[] = [];
            if (completedOps) parts.push(`Completed: ${completedOps}`);
            if (failedOps) parts.push(`Failed: ${failedOps}`);
            if (error) parts.push(`Error: ${error}`);
            detailedError = parts.join(' | ') || error;
        }
        return {
            // Fall back to the last substantive assistant text when the run did not
            // end on a clean 'done' turn — a tool-call turn has empty content, and
            // returning that would give the user an empty assistant bubble.
            content: content.trim() ? content : lastModelContent,
            success: effectiveSuccess,
            steps,
            toolCallCount,
            taskContext: finishTask(taskContext),
            stopReason,
            changedWorkspace,
            error: detailedError,
        };
    };

    for (let step = 0; step < budget.maxSteps; step++) {
        if (req.signal?.aborted) return finish('cancelled', false, 'Cancelled');

        if (Date.now() >= deadline) {
            return finish('budget_time', changedWorkspace || steps.length > 0, 'Stopped: the agent run reached its time budget.');
        }

        req.onStatus?.('thinking');

        // ---- 1+2. request → response (existing AIClient + fallback chain) ---
        // The model call is bounded by BOTH a per-call timeout and the task's
        // remaining wall budget. Without it, one hung provider request stalls
        // the agent past its own deadline until something external wins.
        const remainingBudget = deadline - Date.now();
        if (remainingBudget <= 0) {
            return finish('budget_time', changedWorkspace || steps.length > 0, 'Stopped: the agent run reached its time budget.');
        }
        const modelCallTimeoutMs = Math.min(budget.modelCallTimeoutMs, remainingBudget);

        let result: Awaited<ReturnType<typeof sendChatResult>>;
        if (typeof AbortController === 'function' && Number.isFinite(modelCallTimeoutMs)) {
            const controller = new AbortController();
            const onOuterAbort = () => controller.abort();
            if (req.signal) {
                if (req.signal.aborted) controller.abort();
                else req.signal.addEventListener('abort', onOuterAbort, { once: true });
            }
            const timer = setTimeout(() => {
                if (!controller.signal.aborted) controller.abort(new Error(`Model call timed out after ${Math.round(modelCallTimeoutMs / 1000)}s`));
            }, modelCallTimeoutMs);
            try {
                result = await withRetry(
                    async () => sendChatResult(messages, {
                        model: req.model,
                        task: 'complex_code',
                        temperature: 0.1,
                        maxTokens: 4096,
                        signal: controller.signal,
                        tools: definitions,
                        toolChoice: 'auto',
                        providerTarget: req.providerTarget,
                    }),
                    controller.signal
                );
            } catch (e) {
                if (isAbortError(e) && req.signal?.aborted) return finish('cancelled', false);
                // Provider failure after all retries — check if transient
                const err = e instanceof Error ? e : new Error(String(e));
                const aiErr = err instanceof AIError ? err : null;
                const isTransient = aiErr ? aiErr.retryable === true : isTransientProviderError(err);
                if (isTransient && changedWorkspace) {
                    // Transient failure after successful tool execution: wait and continue loop to retry
                    console.warn(`[AgentLoop] Transient provider failure after tool execution, will retry: ${err.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                // Permanent failure or no workspace changes yet — surface honestly
                return finish('error', false, err.message);
            } finally {
                clearTimeout(timer);
                req.signal?.removeEventListener('abort', onOuterAbort);
            }
        } else {
            try {
                result = await withRetry(
                    async () => sendChatResult(messages, {
                        model: req.model,
                        task: 'complex_code',
                        temperature: 0.1,
                        maxTokens: 4096,
                        signal: req.signal,
                        tools: definitions,
                        toolChoice: 'auto',
                        providerTarget: req.providerTarget,
                    }),
                    req.signal
                );
            } catch (e) {
                if (isAbortError(e)) return finish('cancelled', false);
                const err = e instanceof Error ? e : new Error(String(e));
                const aiErr = err instanceof AIError ? err : null;
                const isTransient = aiErr ? aiErr.retryable === true : isTransientProviderError(err);
                if (isTransient && changedWorkspace) {
                    console.warn(`[AgentLoop] Transient provider failure after tool execution, will retry: ${err.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                return finish('error', false, err.message);
            }
        }

        if (!result.ok) {
            if (result.error?.retryable === false && /abort/i.test(result.error.message)) {
                return finish('cancelled', false);
            }
            // A transient provider verdict is recoverable when the task already
            // has verified work to preserve. Retry within the same bounded
            // step budget (the outer withRetry only sees thrown errors, and
            // AIClient deliberately returns typed errors through its union).
            if (
                result.error?.retryable === true &&
                changedWorkspace &&
                transientModelFailures < RETRY_CONFIG.maxRetries
            ) {
                transientModelFailures++;
                console.warn(
                    `[AgentLoop] Transient provider failure after tool execution, retrying (${transientModelFailures}/${RETRY_CONFIG.maxRetries}): ${result.error.message}`,
                );
                req.onStatus?.('thinking');
                continue;
            }
            return finish('error', false, result.error?.message ?? 'The assistant request failed');
        }

        transientModelFailures = 0;

        // ---- 3. identify STRUCTURED tool calls ----------------------------
        const toolCalls = result.toolCalls ?? [];
        content = result.content || '';
        if (content.trim()) lastModelContent = content;

        // The model's own words are the record of what it intended to do.
        // Harvesting them here is what makes the completion decision
        // evidence-based instead of "the model stopped talking".
        if (content.trim()) {
            taskContext = recordAnnouncedPaths(taskContext, content);
        }

        if (toolCalls.length === 0) {
            // No tool calls. This is the natural exit of the loop — but it is
            // NOT automatically completion.
            //
            // The previous behaviour returned `done`/`success: true` for ANY
            // text-only turn. Providers routinely split a turn, and models
            // routinely emit an intermediate "now let me create the CSS
            // file…" with no tool calls attached. The run then ended after
            // the first file, reported `success: true`, and the final
            // response repeated the model's claim that everything was done.
            //
            // The decision is now made against real evidence:
            //   - did the model announce work that is still OUTSTANDING?
            //   - did any operation FAIL?
            //   - is this the first step? (models often emit a planning message first)
            // If any is true, the task is not finished and the model is
            // asked to continue.
            messages.push({ role: 'assistant', content });

            const outstanding = computeRemainingPaths(taskContext, p => pathExistsInTree(req.deps.getFileTree(), p));
            const hasFailure = taskContext.operations.some(o => o.status === 'error');
            const isFirstStep = step === 0;

            // Check if the model's content indicates it's PLANNING future work
            // (future/present tense only — not past tense completion summaries)
            const contentIndicatesPlanning = content.trim().length > 0 && 
                /\b(?:plan|will|going to|need to|must|should|create|build|implement|write|generate|add|make|setup|initialize|scaffold)\b/i.test(content)
                && !/\b(?:created|built|implemented|wrote|generated|added|made|setup|initialized|scaffolded|finished|done|completed)\b/i.test(content);

            if (!outstanding.length && !hasFailure && !isFirstStep && !contentIndicatesPlanning) {
                return finish('done', true);
            }

            // Not complete. Continue — but only while there is budget left and
            // the model is not stuck repeating itself.
            if (step + 1 >= budget.maxSteps) {
                return finish('budget_steps', changedWorkspace, 'Stopped: the agent reached its step budget before finishing.');
            }
            if (Date.now() >= deadline) {
                return finish('budget_time', changedWorkspace, 'Stopped: the agent run reached its time budget.');
            }

            // Tell the model exactly what is left, so it can continue rather
            // than repeat itself. This is real state, not a guess.
            const remainingNote = outstanding.length
                ? `Still to do: ${outstanding.join(', ')} — these files do not exist in the workspace yet.`
                : (hasFailure
                    ? 'A previous operation failed — fix that before finishing.'
                    : (isFirstStep || contentIndicatesPlanning)
                        ? 'Good start. Now use the tools to execute your plan.'
                        : 'The task appears incomplete. Continue with the next steps.');

            messages.push({
                role: 'user',
                content: `Continue. The task is not finished yet. ${remainingNote} Use the tools to finish the work, then reply with a summary of what you actually changed.`,
            });
            continue;
        }

        if (toolCallCount + toolCalls.length > budget.maxToolCalls) {
            return finish('budget_tool_calls', changedWorkspace, 'Stopped: the agent reached its tool-call budget.');
        }

        // ---- record the assistant turn WITH its tool_calls ----------------
        // This is the protocol-correct way to return results to the model:
        // the assistant message that requested them is preserved.
        messages.push({ role: 'assistant', content, tool_calls: toolCalls });

        req.onStatus?.('tool');

        const stepRecord: AgentStepRecord = { step: step + 1, requested: [], content };

        // Per-call plan, kept in the model's original request order so `tool`
        // messages are appended deterministically.
        type CallPlan = {
            id: string;
            name: string;
            target: string;
            /** Parsed arguments (undefined only for pre-resolved failures). */
            args?: Record<string, unknown>;
            /** Non-executable call: schema/argument validation already failed. */
            validationError?: string;
            /** Idempotent duplicate-write acknowledgement (never re-executed). */
            duplicateOf?: ToolResult;
            /** Real execution result, filled during dispatch. */
            result?: ToolResult;
        };

        // Duplicate-write guard: if the tree changed underneath us, the
        // cached fingerprints describe a stale world — recompute lazily.
        const treeSize = req.deps.getFileTree().length;
        if (treeSize !== lastTreeSize) {
            writeFingerprints.clear();
            lastTreeSize = treeSize;
        }

        // ---- 4. pre-resolve every call (schema + argument validation) ----
        const plans: Array<CallPlan | 'skipped-budget'> = [];
        let budgetExhausted = false;
        for (const call of toolCalls) {
            if (budgetExhausted) { plans.push('skipped-budget'); continue; }
            const name = call.function?.name ?? '';
            const schema = toolSchema(name);
            if (!schema) {
                plans.push({
                    id: call.id,
                    name: name || 'unknown',
                    target: '',
                    validationError: `Unknown tool: ${name || '(missing name)'}`,
                });
                continue;
            }
            // Malformed JSON arguments are an INVALID call — never coerced.
            const args = parseToolArguments(call.function.arguments);
            if (args === null) {
                plans.push({
                    id: call.id,
                    name,
                    target: '',
                    validationError: `Invalid arguments for ${name}: arguments must be a JSON object`,
                });
                continue;
            }
            if (toolCallCount + 1 > budget.maxToolCalls) {
                budgetExhausted = true;
                plans.push('skipped-budget');
                continue;
            }
            toolCallCount++;
            const target = typeof args.path === 'string' ? args.path : (typeof args.newPath === 'string' ? args.newPath : '');

            // ---- duplicate-write guard ------------------------------------
            // A model re-requesting byte-identical content for a path it
            // already wrote is answered idempotently instead of writing again.
            if (WRITE_TOOLS.has(name) && typeof args.content === 'string') {
                const fp = `${name}:${String(args.path)}:${fingerprint(args.content)}`;
                if (writeFingerprints.has(fp)) {
                    plans.push({
                        id: call.id, name, target,
                        args,
                        duplicateOf: {
                            ok: true,
                            data: { path: args.path, applied: false, note: 'This exact content was already written in this task — no change needed.' },
                        },
                    });
                    continue;
                }
                writeFingerprints.add(fp);
            }

            plans.push({ id: call.id, name, target, args });
        }

        // ---- 5+6. dispatch — consecutive read-only calls run concurrently --
        // Read-only tools have no ordering side effects; writes stay strictly
        // sequential (their application order IS observable behavior).
        const executePlan = (p: CallPlan): Promise<void> =>
            withTimeout(
                executeTool(p.name, p.args ?? {}, {
                    ...req.deps,
                    isCancelled: () => Boolean(req.signal?.aborted),
                }),
                budget.toolTimeoutMs,
                req.signal,
            ).then(
                (r) => { p.result = r; },
                (e) => {
                    p.result = { ok: false, data: {}, error: e instanceof Error ? e.message : String(e) };
                    if (isAbortError(e)) throw e;
                },
            );

        let i = 0;
        while (i < plans.length) {
            const p = plans[i];
            if (p === 'skipped-budget' || p.validationError || p.duplicateOf) { i++; continue; }
            if (req.signal?.aborted) return finish('cancelled', false);
            if (Date.now() >= deadline) return finish('budget_time', changedWorkspace, 'Stopped: the agent run reached its time budget.');

            // Find the maximal consecutive run of read-only calls.
            let j = i;
            while (j < plans.length) {
                const q = plans[j];
                if (q === 'skipped-budget' || q.validationError || q.duplicateOf) break;
                if (!READ_TOOLS.has(q.name)) break;
                j++;
            }
            const batchSize = j - i;
            try {
                if (batchSize > 1) {
                    const batch = plans.slice(i, j) as CallPlan[];
                    const limit = Math.max(1, Math.min(budget.maxConcurrentReads, 8, batchSize));
                    await runWithConcurrency(batch, limit, executePlan);
                    if (req.signal?.aborted) return finish('cancelled', false);
                } else {
                    await executePlan(plans[i] as CallPlan);
                }
            } catch (e) {
                if (isAbortError(e)) return finish('cancelled', false);
                // Concurrent worker failures remain in the outcomes below.
            }
            i = Math.max(j, i + 1);
        }

        // ---- 7. bookkeeping + result propagation in original order -------
        for (let k = 0; k < plans.length; k++) {
            const p = plans[k];
            if (p === 'skipped-budget') {
                // The assistant turn requested this call, so the protocol still
                // requires a `tool` result for its id — otherwise the next
                // provider call fails with an orphaned tool_call_id.
                const reqTool = toolCalls[k]?.function?.name ?? 'unknown';
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCalls[k]?.id ?? `call_${k}`,
                    name: reqTool,
                    content: JSON.stringify({ ok: false, tool: reqTool, error: 'Skipped: the agent reached its tool-call budget. Finish the task with a summary.' }),
                });
                continue;
            }
            if (p.validationError) {
                stepRecord.requested.push({ tool: p.name, target: '', ok: false, error: p.validationError });
                if (p.validationError.startsWith('Invalid arguments')) {
                    taskContext = recordOperation(taskContext, { tool: p.name, target: '', status: 'error', detail: 'invalid arguments' });
                }
                messages.push({ role: 'tool', tool_call_id: p.id, name: p.name, content: JSON.stringify({ ok: false, tool: p.name, error: p.validationError }) });
                continue;
            }
            if (p.duplicateOf) {
                stepRecord.requested.push({ tool: p.name, target: p.target, ok: true });
                taskContext = recordOperation(taskContext, { tool: p.name, target: p.target, status: 'ok', detail: 'skipped duplicate write' });
                messages.push({ role: 'tool', tool_call_id: p.id, name: p.name, content: boundResult(serializeToolResult(p.duplicateOf, p.name), budget.maxToolResultChars) });
                continue;
            }
            const toolResult = p.result;
            if (!toolResult) continue; // defensively unreachable — dispatch always sets a result

            stepRecord.requested.push({ tool: p.name, target: p.target, ok: toolResult.ok, error: toolResult.error });

            // ---- real result accounting (Phase 10 honesty) ----------------
            taskContext = recordOperation(taskContext, {
                tool: p.name,
                target: p.target,
                status: toolResult.ok ? 'ok' : 'error',
                detail: toolResult.ok ? undefined : toolResult.error,
            });
            if (toolSchema(p.name)?.mutating && toolResult.ok && toolResult.data.applied !== false) {
                changedWorkspace = true;
            }
            if (p.name === 'get_diagnostics' && toolResult.ok && toolResult.data.isError) {
                const markers = (toolResult.data.markers as Array<{ message?: string; line?: number }>) ?? [];
                for (const m of markers.slice(0, 3)) {
                    taskContext = recordValidationFailure(taskContext, String(toolResult.data.path ?? p.target), m.message ?? 'Diagnostic error');
                }
            }

            // ---- append the REAL result back to the model ------------------
            let serialized = boundResult(serializeToolResult(toolResult, p.name), budget.maxToolResultChars);
            const remaining = budget.maxTotalToolResultChars - totalToolResultChars;
            if (remaining <= 0) {
                serialized = JSON.stringify({ ok: toolResult.ok, tool: p.name, note: 'Context budget for tool results exhausted.' });
            } else {
                serialized = boundResult(serialized, remaining);
                totalToolResultChars += serialized.length;
            }
            messages.push({ role: 'tool', tool_call_id: p.id, name: p.name, content: serialized });

            // ---- Notify UI of file changes for real-time Monaco/explorer sync ----
            if (toolResult.ok && req.onFileChanged) {
                const mutatingTools = new Set(['create_file', 'write_file', 'replace_range', 'insert_text', 'delete_range', 'rename_file', 'delete_file']);
                if (mutatingTools.has(p.name)) {
                    const action = p.name === 'delete_file' || p.name === 'delete_range' ? 'deleted' : 
                                   p.name === 'create_file' ? 'created' : 'updated';
                    req.onFileChanged(p.target, action, toolResult.data.content as string | undefined);
                }
            }

            // ---- loop protection: identical repeat failures ---------------
            if (!toolResult.ok) {
                const signature = `${p.name}:${JSON.stringify(p.args)}:${toolResult.error ?? ''}`;
                if (signature === lastFailureSignature) {
                    repeatFailureCount++;
                } else {
                    lastFailureSignature = signature;
                    repeatFailureCount = 1;
                }
                if (repeatFailureCount >= 3) {
                    steps.push(stepRecord);
                    req.onStep?.(stepRecord);
                    return finish('repeated_failure', changedWorkspace, `Stopped after the same "${p.name}" call failed repeatedly: ${toolResult.error}`);
                }
                if (toolResult.requiresApproval) {
                    steps.push(stepRecord);
                    req.onStep?.(stepRecord);
                    return finish('approval_required', changedWorkspace, toolResult.error);
                }
            } else {
                lastFailureSignature = null;
                repeatFailureCount = 0;
            }
        }

        steps.push(stepRecord);
        req.onStep?.(stepRecord);

        // Loop protection: context must not grow without bound. If the
        // conversation has grown past the step budget's worth of turns, we
        // collapse the oldest tool traffic into a compact summary the model
        // can still reason about (real results preserved, not invented).
        compactToolHistory(messages);
    }

    // Exhausted the step budget — report honestly rather than pretending done.
    return finish('budget_steps', changedWorkspace, 'Stopped: the agent reached its step budget before finishing.');
}

/**
 * Keep the conversation bounded across a long run.
 *
 * The SYSTEM prompt and the most recent turns (which carry the live state the
 * model needs) are always kept. Older tool traffic is replaced by a single
 * compact summary line recording how many operations ran — so the model still
 * knows work happened, without an unbounded transcript.
 *
 * The kept tail is expanded BACKWARDS so an assistant turn carrying
 * `tool_calls` is never split from its own `tool` result messages: providers
 * reject an orphaned `tool_call_id` with a 400, which previously killed the
 * whole agent run on step trimming.
 */
export function compactToolHistory(messages: ChatMessage[], keepTail = 14): void {
    if (messages.length <= keepTail + 1) return;
    const head = messages[0]; // system
    let firstKept = messages.length - keepTail;
    if (firstKept < 1) firstKept = 1;
    while (firstKept > 1 && messages[firstKept] && messages[firstKept].role === 'tool') firstKept--;
    const droppedCount = firstKept - 1;
    const tail = messages.slice(firstKept);
    const toolResultsKept = tail.filter(m => m.role === 'tool').length;
    messages.length = 0;
    messages.push(head);
    if (droppedCount > 0) {
        messages.push({
            role: 'user',
            content: `[conversation compacted: ${droppedCount} earlier turns elided, ${toolResultsKept} tool results still shown below. Re-read a file if you need details you no longer have.]`,
        });
    }
    messages.push(...tail);
}

/**
 * Runs `fn` over `items` with bounded concurrency (max `limit` in flight).
 * Failures propagate through `fn` — workers stop naturally when items run out.
 */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, () => (async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    })());
    await Promise.all(workers);
}

/** Reject a promise that overruns `ms`, honouring cancellation. */
function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms`)), ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (signal) {
            if (signal.aborted) {
                clearTimeout(timer);
                reject(new DOMException('The operation was aborted.', 'AbortError'));
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        promise.then(
            v => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(v);
            },
            e => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                reject(e);
            },
        );
    });
}