const { getMaxTokens } = require('./aiClient.cjs');
const { getTaskConfig } = require('./taskConfig.cjs');
const { buildRoutingPlan, resolveModel } = require('./modelRouter.cjs');

/**
 * Resolves the effective request parameters (temperature / max tokens /
 * reasoning controls) from the centralized per-task profile.
 * - The user's responseLength setting keeps governing plain chat output length.
 * - An explicit `maxTokens` from the client (used for autocomplete caps) wins.
 * - All other tasks fall back to their profile.
 */
function resolveTaskParams({ task, maxTokens, temperature, top_p, responseLength = 'medium' }) {
    const profile = getTaskConfig(task);
    return {
        task,
        temperature: temperature ?? profile.temperature,
        top_p: top_p ?? profile.top_p ?? 0.95,
        maxTokens: maxTokens ?? (task === 'chat' ? getMaxTokens(responseLength) : profile.maxTokens),
        reasoningMode: profile.reasoningMode || 'off',
        chatTemplateKwargs: profile.chatTemplateKwargs || null,
    };
}

// Whole-line reasoning preambles that must never reach the user. Only LEADING
// lines are stripped so legitimate sentences deep in a response are preserved.
// Mirrors the streaming filter's LEADING_REASONING_LINE_RE (aiStream.cjs) for
// the non-streamed path — same critical strings, same defensive posture.
const REASONING_PREAMBLE_RE = [
    /^self-correction\/[a-z0-9-]+\s*(?:during\s+\w+|[:：]|$).*$/i,
    /^the user (?:wants|asked|needs|requested|would like|is asking|is trying|is requesting|is looking for|is expecting)\b.*$/i,
    /^the prompt says.*$/i,
    /^wait,? the prompt says.*$/i,
    /^all constraints? (?:checked|satisfied|verified)[:：]?.*$/i,
    /^i (?:need to|will|am going to|'m going to|should|have to)\b.*$/i,
    /^let'?s (?:check|review|analyze|look at|verify|see)\b.*$/i,
    /^final check\b.*$/i,
    /^let me (?:think|check|review|analyze|verify)\b.*$/i,
    /^(?:my|the) (?:approach|plan|strategy|reasoning|thought)\s*[:：].*$/i,
    /^(?:note|notes)\s*[:：].*$/i,
    /^reasoning (?:trace|process).*$/i,
    /^internal (?:reasoning|verification|check).*$/i,
    /^chain of thought.*$/i,
];

function stripLeadingReasoningLines(text) {
    let lines = text.split('\n');
    while (lines.length > 0 && REASONING_PREAMBLE_RE.some((re) => re.test(lines[0].trim()))) {
        lines.shift();
    }
    // Drop a leading "Result:" prefix token but keep the answer after it.
    if (lines.length > 0) {
        lines[0] = lines[0].replace(/^[ \t]*result\s*[:：]/i, '');
    }
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    return lines.join('\n');
}

/**
 * Non-streamed response sanitizer. Strips every reasoning shape (Qwen inline
 *  thinking/analysis...response , XML <thinking></thinking>, <analysis></analysis>,
 *  leading reasoning preambles) before the content is returned. Empty stays empty — a reasoning-
 * only response must not be re-exposed by a `|| original` fallback.
 */
function cleanResponse(content) {
    if (!content) return '';
    let cleaned = content;

    // Qwen-style inline think/analysis blocks (\n thinking\n ... \n response\n).
    cleaned = cleaned.replace(/\n[ \t]*(?:thinking|analysis)[ \t]*\n[\s\S]*?\n[ \t]*response[ \t]*\n/g, '\n');
    // Leading inline think/analysis block (including one preceded by a newline) that
    // never closes is reasoning — drop it, never leak it.
    if (/^\s*(?:thinking|analysis)[ \t]*\n/.test(cleaned)) {
        cleaned = cleaned.replace(/^\s*(?:thinking|analysis)[ \t]*\n[\s\S]*?(?:\n[ \t]*response[ \t]*\n|$)/, '');
    }

    // XML-style thinking/analysis blocks (closed + trailing-unclosed).
    cleaned = cleaned.replace(/<\s*(?:think(?:ing)?|analysis)[\s\S]*?(?:<\s*\/\s*(?:think(?:ing)?|analysis)\s*>|$)/gi, '');

    cleaned = stripLeadingReasoningLines(cleaned);

    const codeBlockMatch = cleaned.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[2];
    } else {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim();
}

/**
 * Builds the ordered list of provider/models to try.
 *
 * - `allowFallback:false` (autocomplete, low-latency paths) returns ONLY the
 *   requested model — no expensive fallback chains.
 * - Providers known to be unhealthy (cached failure) or unconfigured (missing
 *   API key) are skipped so we never waste seconds on a known-unavailable
 *   provider.
 *
 * Model strings are resolved through the model router, which also returns the
 * per-provider request controls (`chatTemplateKwargs`, `forceNonemptyContent`).
 */
function buildFallbackChain(requestedModel, { allowFallback = true } = {}) {
    const plan = buildRoutingPlan('chat', requestedModel, { allowFallback });
    return [plan.primary.model, ...plan.fallbacks.map((f) => f.model)];
}

module.exports = {
    resolveTaskParams,
    cleanResponse,
    stripLeadingReasoningLines,
    resolveModel,
    buildRoutingPlan,
    buildFallbackChain,
};