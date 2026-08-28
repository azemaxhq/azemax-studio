/**
 * Per-task AI profile regression suite (task-aware reasoning policy).
 *
 * Guards the single source of truth for the Nemotron reasoning configuration:
 * - fast / latency-critical tasks MUST have reasoning DISABLED (no thinking)
 * - chat + explanation use reasoning OFF too (fast TTFB, no trace to leak)
 * - only complex/debug work uses bounded LOW-effort reasoning (never full)
 * - deep_reasoning (high) is the ONLY full-thinking profile
 * - reasoning budgets MUST be bounded and strictly < max_tokens
 * - max_tokens budgets are bounded per task (no oversized caps)
 * - client task-key routing mirrors the server task profiles
 *
 * Server profiles are pure CommonJS with no I/O, so they are imported directly.
 * Run: npx tsx tests/taskProfiles.test.ts
 */
import { check, finish } from './_harness';
import { AI_TASK_CONFIG, getTaskConfig } from '../server/services/ai/taskConfig.cjs';
import { TASK_KEY_BY_TYPE, taskContextBudget } from '../src/core/ai/AIContextBuilder';
import { resolveModel } from '../server/services/ai/modelRouter.cjs';
import type { AiTaskKey } from '../src/core/ai';

const reasoningOff = (task: string): boolean => {
    const profile = getTaskConfig(task);
    return !profile.chatTemplateKwargs?.enable_thinking;
};

const reasoningLow = (task: string): boolean => {
    const resolved = resolveModel(task, undefined);
    return resolved.chatTemplateKwargs?.enable_thinking === true
        && resolved.chatTemplateKwargs?.reasoning_effort === 'low';
};

const reasoningHigh = (task: string): boolean => {
    const resolved = resolveModel(task, undefined);
    return resolved.chatTemplateKwargs?.reasoning_effort === 'high';
};

// ============================================================================
// Reasoning OFF for latency-critical AND conversational/simple tasks
// ============================================================================
for (const off of ['autocomplete', 'comment', 'simple_edit', 'fast_chat', 'chat', 'explanation']) {
    check(`profile: ${off} has reasoning disabled`, reasoningOff(off));
}

// ============================================================================
// Low-effort reasoning ONLY for complex/debug work (bounded trace)
// ============================================================================
check('profile: complex_code uses low-effort reasoning', reasoningLow('complex_code'));

// deep_reasoning (high) exists but is NOT wired as a default
check('profile: deep_reasoning is full thinking', reasoningHigh('deep_reasoning'));
const deepResolved = resolveModel('deep_reasoning', undefined);
check('profile: deep_reasoning not low effort', deepResolved.chatTemplateKwargs?.reasoning_effort !== 'low');

// ============================================================================
// Reasoning budget invariant: budgets are NOT configured for any profile.
// The hosted NVIDIA API 500s on `reasoning_budget`, so a profile that sets one
// would fail every request at the primary provider. Guard that this never
// regresses.
// ============================================================================
for (const [task, profile] of Object.entries(AI_TASK_CONFIG)) {
    check(`profile: ${task} sets no reasoningBudget (hosted API 500s on it)`, profile.reasoningBudget === undefined || profile.reasoningBudget === 0);
}

// ============================================================================
// max_tokens budgets bounded per task
// ============================================================================
const MAX_BUDGETS: Record<string, number> = {
    autocomplete: 512,
    comment: 512,
    simple_edit: 4096,
    chat: 4096,
    explanation: 4096,
    complex_code: 8192,
    fast_chat: 1024,
    deep_reasoning: 16384,
};
for (const [task, cap] of Object.entries(MAX_BUDGETS)) {
    check(`profile: ${task} maxTokens within budget (${getTaskConfig(task).maxTokens} <= ${cap})`, getTaskConfig(task).maxTokens <= cap);
}

// ============================================================================
// Client task routing mirrors server profiles
// ============================================================================
check('routing: code-gen -> simple_edit', TASK_KEY_BY_TYPE['code-gen'] === 'simple_edit');
check('routing: explain -> explanation', TASK_KEY_BY_TYPE.explain === 'explanation');
check('routing: fix -> complex_code', TASK_KEY_BY_TYPE.fix === 'complex_code');
check('routing: refactor -> complex_code', TASK_KEY_BY_TYPE.refactor === 'complex_code');
check('routing: inline-suggest -> autocomplete', TASK_KEY_BY_TYPE['inline-suggest'] === 'autocomplete');
check('routing: chat -> chat', TASK_KEY_BY_TYPE.chat === 'chat');

// ============================================================================
// Context budgets: latency-critical tasks have tiny windows
// ============================================================================
const autocompleteCtx = taskContextBudget('autocomplete');
check('ctx: autocomplete context is tiny', autocompleteCtx.maxChars <= 2000 && autocompleteCtx.maxMessages <= 2);
const chatCtx = taskContextBudget('chat');
check('ctx: chat context is larger than autocomplete', chatCtx.maxChars > autocompleteCtx.maxChars);

// ============================================================================
// Unknown task falls back to chat profile (safe default, reasoning off)
// ============================================================================
check('profile: unknown task falls back to chat (reasoning off)', reasoningOff('unknown-task-xyz'));
check('profile: unknown task keeps reasoning bounded', getTaskConfig('unknown-task-xyz').maxTokens <= 4096);

// Type-level guarantee that every AiTaskKey routes (compile-time check)
const allKeys: AiTaskKey[] = ['chat', 'simple_edit', 'explanation', 'complex_code', 'autocomplete', 'comment'];
for (const key of allKeys) {
    check(`profile: ${key} has a resolved config`, Boolean(getTaskConfig(key).maxTokens));
}

finish('taskProfiles');
