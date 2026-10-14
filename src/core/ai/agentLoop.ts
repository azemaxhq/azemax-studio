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
import { executeTool, parseToolArguments, toolSchema, toolDefinitions, type AgentToolDeps, type ToolResult } from './agentTools';
import {
    AGENT_SYSTEM_PROMPT,
    DEFAULT_AGENT_BUDGET,
    buildAgentMessages,
    finishTask,
    recordOperation,
    recordValidationFailure,
    type AgentBudget,
    type AgentTaskContext,
} from './agentTaskContext';
import type { ChatMessage } from './types';

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
    /** Optional per-step progress callback (drives the UI activity card). */
    onStep?: (step: AgentStepRecord) => void;
    /** Optional status callback for richer UI. */
    onStatus?: (status: 'thinking' | 'tool' | 'verifying' | 'done') => void;
}

const isAbort = (e: unknown): boolean =>
    e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));

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

    const finish = (
        stopReason: AgentLoopResult['stopReason'],
        success: boolean,
        error?: string,
    ): AgentLoopResult => ({
        // Fall back to the last substantive assistant text when the run did not
        // end on a clean 'done' turn — a tool-call turn has empty content, and
        // returning that would give the user an empty assistant bubble.
        content: content.trim() ? content : lastModelContent,
        success,
        steps,
        toolCallCount,
        taskContext: finishTask(taskContext),
        stopReason,
        changedWorkspace,
        error,
    });

    for (let step = 0; step < budget.maxSteps; step++) {
        if (req.signal?.aborted) return finish('cancelled', false, 'Cancelled');

        if (Date.now() >= deadline) {
            return finish('budget_time', changedWorkspace || steps.length > 0, 'Stopped: the agent run reached its time budget.');
        }

        req.onStatus?.('thinking');

        // ---- 1+2. request → response (existing AIClient + fallback chain) ---
        let result: Awaited<ReturnType<typeof sendChatResult>>;
        try {
            result = await sendChatResult(messages, {
                model: req.model,
                task: 'complex_code',
                temperature: 0.1,
                maxTokens: 4096,
                signal: req.signal,
                tools: definitions,
                toolChoice: 'auto',
            });
        } catch (e) {
            if (isAbort(e)) return finish('cancelled', false);
            // Provider failure — surface honestly; partial work is reported
            // truthfully via changedWorkspace.
            return finish('error', false, e instanceof Error ? e.message : String(e));
        }

        if (!result.ok) {
            if (result.error?.retryable === false && /abort/i.test(result.error.message)) {
                return finish('cancelled', false);
            }
            return finish('error', false, result.error.message);
        }

        // ---- 3. identify STRUCTURED tool calls ----------------------------
        const toolCalls = result.toolCalls ?? [];
        content = result.content || '';
        if (content.trim()) lastModelContent = content;

        if (toolCalls.length === 0) {
            // No tool calls → the model considers the task done. This is the
            // natural exit of the loop and the ONLY exit that counts as a
            // successful completion.
            messages.push({ role: 'assistant', content });
            return finish('done', true);
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

        for (const call of toolCalls) {
            if (req.signal?.aborted) return finish('cancelled', false);
            if (Date.now() >= deadline) return finish('budget_time', changedWorkspace, 'Stopped: the agent run reached its time budget.');

            const name = call.function?.name ?? '';
            const schema = toolSchema(name);

            // ---- 4. validate ---------------------------------------------
            if (!schema) {
                const err = `Unknown tool: ${name || '(missing name)'}`;
                stepRecord.requested.push({ tool: name || '(unknown)', target: '', ok: false, error: err });
                messages.push({ role: 'tool', tool_call_id: call.id, name: name || 'unknown', content: JSON.stringify({ ok: false, error: err }) });
                continue;
            }

            // Malformed JSON arguments are an INVALID call — never coerced.
            const args = parseToolArguments(call.function.arguments);
            if (args === null) {
                const err = `Invalid arguments for ${name}: arguments must be a JSON object`;
                stepRecord.requested.push({ tool: name, target: '', ok: false, error: err });
                taskContext = recordOperation(taskContext, { tool: name, target: '', status: 'error', detail: 'invalid arguments' });
                messages.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify({ ok: false, tool: name, error: err }) });
                continue;
            }

            const target = typeof args.path === 'string' ? args.path : (typeof args.newPath === 'string' ? args.newPath : '');

            if (toolCallCount >= budget.maxToolCalls) {
                return finish('budget_tool_calls', changedWorkspace, 'Stopped: the agent reached its tool-call budget.');
            }
            toolCallCount++;

            // Duplicate-write guard: if the tree changed underneath us, the
            // cached fingerprints describe a stale world — recompute lazily.
            const treeSize = req.deps.getFileTree().length;
            if (treeSize !== lastTreeSize) {
                writeFingerprints.clear();
                lastTreeSize = treeSize;
            }

            // ---- duplicate-write guard ------------------------------------
            // A model re-requesting byte-identical content for a path it
            // already wrote is answered idempotently instead of writing again.
            if (WRITE_TOOLS.has(name) && typeof args.content === 'string') {
                const fp = `${name}:${String(args.path)}:${fingerprint(args.content)}`;
                if (writeFingerprints.has(fp)) {
                    const dup: ToolResult = {
                        ok: true,
                        data: { path: args.path, applied: false, note: 'This exact content was already written in this task — no change needed.' },
                    };
                    stepRecord.requested.push({ tool: name, target, ok: true });
                    taskContext = recordOperation(taskContext, { tool: name, target, status: 'ok', detail: 'skipped duplicate write' });
                    messages.push({ role: 'tool', tool_call_id: call.id, name, content: boundResult(serializeToolResult(dup, name), budget.maxToolResultChars) });
                    continue;
                }
                writeFingerprints.add(fp);
            }

            // ---- 5+6. execute the REAL tool ------------------------------
            let toolResult: ToolResult;
            try {
                toolResult = await withTimeout(
                    executeTool(name, args, {
                        ...req.deps,
                        isCancelled: () => Boolean(req.signal?.aborted),
                    }),
                    budget.toolTimeoutMs,
                    req.signal,
                );
            } catch (e) {
                if (isAbort(e)) return finish('cancelled', false);
                toolResult = { ok: false, data: {}, error: e instanceof Error ? e.message : String(e) };
            }

            stepRecord.requested.push({ tool: name, target, ok: toolResult.ok, error: toolResult.error });

            // ---- real result accounting (Phase 10 honesty) ----------------
            taskContext = recordOperation(taskContext, {
                tool: name,
                target,
                status: toolResult.ok ? 'ok' : 'error',
                detail: toolResult.ok ? undefined : toolResult.error,
            });
            if (schema.mutating && toolResult.ok && toolResult.data.applied !== false) {
                changedWorkspace = true;
            }
            if (name === 'get_diagnostics' && toolResult.ok && toolResult.data.isError) {
                const markers = (toolResult.data.markers as Array<{ message?: string; line?: number }>) ?? [];
                for (const m of markers.slice(0, 3)) {
                    taskContext = recordValidationFailure(taskContext, String(toolResult.data.path ?? target), m.message ?? 'Diagnostic error');
                }
            }

            // ---- 7. append the REAL result back to the model --------------
            let serialized = boundResult(serializeToolResult(toolResult, name), budget.maxToolResultChars);
            const remaining = budget.maxTotalToolResultChars - totalToolResultChars;
            if (remaining <= 0) {
                serialized = JSON.stringify({ ok: toolResult.ok, tool: name, note: 'Context budget for tool results exhausted.' });
            } else {
                serialized = boundResult(serialized, remaining);
                totalToolResultChars += serialized.length;
            }
            messages.push({ role: 'tool', tool_call_id: call.id, name, content: serialized });

            // ---- loop protection: identical repeat failures ---------------
            if (!toolResult.ok) {
                const signature = `${name}:${JSON.stringify(args)}:${toolResult.error ?? ''}`;
                if (signature === lastFailureSignature) {
                    repeatFailureCount++;
                } else {
                    lastFailureSignature = signature;
                    repeatFailureCount = 1;
                }
                if (repeatFailureCount >= 3) {
                    steps.push(stepRecord);
                    req.onStep?.(stepRecord);
                    return finish('repeated_failure', changedWorkspace, `Stopped after the same "${name}" call failed repeatedly: ${toolResult.error}`);
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
 */
function compactToolHistory(messages: ChatMessage[], keepTail = 14): void {
    if (messages.length <= keepTail + 1) return;
    const head = messages[0]; // system
    const tail = messages.slice(-keepTail);
    const dropped = messages.length - 1 - keepTail;
    const toolResultsKept = tail.filter(m => m.role === 'tool').length;
    messages.length = 0;
    messages.push(head);
    if (dropped > 0) {
        messages.push({
            role: 'user',
            content: `[conversation compacted: ${dropped} earlier turns elided, ${toolResultsKept} tool results still shown below. Re-read a file if you need details you no longer have.]`,
        });
    }
    messages.push(...tail);
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