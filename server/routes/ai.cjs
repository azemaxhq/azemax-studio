const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireVerifiedEmail } = require('../middleware/auth.cjs');
const { sendChat, streamChat, proxyOpenRouter, listModels } = require('../services/ai/chatService.cjs');
const { inferProvider } = require('../services/ai/aiClient.cjs');
const {
    validateRequestedModel,
    validateRequestedModelForProvider,
    buildServerMessages,
    sanitizeTools,
    sanitizeToolChoice,
} = require('../services/ai/aiPolicy.cjs');
const { reserveDaily, recordUsage } = require('../services/auth/authService.cjs');
const { LIMITS } = require('../config/index.cjs');

const router = express.Router();

// AI spends server provider keys — every route requires a verified,
// authenticated account. Unauthenticated or unverified callers are rejected
// (401/403) before any provider work. Input validation + model policy below
// apply to every caller, so there is no unrestricted proxy.
//
// NOTE: the gate is applied PER-ROUTE (never `router.use`) so it can never leak
// into an unrelated router.
const gate = requireVerifiedEmail;

router.get('/models', gate, (_req, res) => {
    res.json({ models: listModels() });
});

const MAX_MESSAGES = LIMITS.AI_MAX_MESSAGES;
const MAX_CONTENT_CHARS = LIMITS.AI_MAX_MESSAGE_CHARS;
const MAX_TOTAL_CHARS = LIMITS.AI_MAX_TOTAL_CHARS;

function validateMessages(messages) {
    if (!Array.isArray(messages)) return 'messages array is required';
    if (messages.length === 0) return 'messages array must not be empty';
    if (messages.length > MAX_MESSAGES) return `messages exceeds limit of ${MAX_MESSAGES}`;
    let total = 0;
    for (const m of messages) {
        if (!m || typeof m.content !== 'string') return 'each message must have a string content';
        if (m.content.length > MAX_CONTENT_CHARS) return `message content exceeds ${MAX_CONTENT_CHARS} chars`;
        total += m.content.length;
        if (total > MAX_TOTAL_CHARS) return `total messages content exceeds ${MAX_TOTAL_CHARS} chars`;
        if (m.role && !['system', 'user', 'assistant', 'tool'].includes(m.role)) return `invalid role: ${m.role}`;
    }
    return null;
}

/**
 * Atomically reserve one daily AI request BEFORE provider work. The unit is
 * charged on attempt (including aborts and provider failures), so retries and
 * disconnects cannot be used to exceed the daily cap.
 */
function reserveAiQuota(userId) {
    if (!reserveDaily(userId, { aiRequests: 1 })) {
        const err = new Error(`Daily AI request limit reached (${LIMITS.AI_REQUESTS_PER_DAY}). Try again tomorrow.`);
        err.status = 429;
        throw err;
    }
}

/**
 * Apply the server AI policy to untrusted client input:
 * - requested model must be on the allowlist of the provider that will serve it
 *   (legacy OpenRouter calls validate against the OpenRouter list specifically)
 * - maxTokens capped to the absolute server ceiling
 * - messages rebuilt with the server-pinned system prompt (client `system`
 *   roles are demoted — history cannot override server behavior)
 */
function applyPolicy({ messages, model, maxTokens, tools, toolChoice, provider }) {
    let resolvedModel = model;
    if (model !== undefined && model !== null) {
        const validated = provider
            ? validateRequestedModelForProvider(model, provider)
            : validateRequestedModel(model, inferProvider);
        if (validated) resolvedModel = validated.model;
    }
    const cappedTokens = maxTokens === undefined || maxTokens === null
        ? maxTokens
        : Math.min(Math.max(1, Math.floor(Number(maxTokens) || 0)), LIMITS.AI_MAX_TOKENS_ABSOLUTE);
    // Tools are validated here, not trusted: a malformed tool definition is
    // rejected with 400 rather than forwarded to a provider.
    let serverTools = null;
    if (tools !== undefined && tools !== null) {
        serverTools = sanitizeTools(tools);
        if (!serverTools) {
            const err = new Error('Invalid tools payload');
            err.status = 400;
            throw err;
        }
        // Tool schemas count toward the same request-size budget as messages;
        // otherwise a client can attach arbitrarily large schemas.
        if (JSON.stringify(serverTools).length > MAX_TOTAL_CHARS) {
            const err = new Error('tools payload exceeds the request size limit');
            err.status = 413;
            throw err;
        }
    }
    return {
        serverMessages: buildServerMessages(messages),
        model: resolvedModel,
        maxTokens: cappedTokens,
        tools: serverTools,
        toolChoice: serverTools ? sanitizeToolChoice(toolChoice) : 'auto',
    };
}

router.post('/chat', gate, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { messages, model, temperature, maxTokens, responseLength, stream, task, allowFallback, tools, toolChoice } = body;

    const validationError = validateMessages(messages);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }
    const policy = applyPolicy({ messages, model, maxTokens, tools, toolChoice });
    reserveAiQuota(req.user.id);

    if (stream) {
        let streamedTokens = 0;
        await streamChat({
            messages: policy.serverMessages,
            model: policy.model,
            temperature,
            maxTokens: policy.maxTokens,
            responseLength,
            res,
            req,
            task,
            allowFallback,
            tools: policy.tools,
            toolChoice: policy.toolChoice,
            userId: req.user.id,
            onUsage: (u) => { streamedTokens = Number(u && u.total_tokens) || 0; },
        });
        recordUsage(req.user.id, { aiTokens: streamedTokens });
        return;
    }

    const abortController = new AbortController();
    // If the client disconnects while a slow non-streaming call is running,
    // abort the upstream provider work instead of burning tokens nobody reads.
    res.on('close', () => {
        if (!res.writableEnded && !res.destroyed) abortController.abort();
    });

    const result = await sendChat({
        messages: policy.serverMessages,
        model: policy.model,
        temperature,
        maxTokens: policy.maxTokens,
        responseLength,
        task,
        allowFallback,
        tools: policy.tools,
        toolChoice: policy.toolChoice,
        requestId: req.id,
        userId: req.user.id,
        signal: abortController.signal,
    });
    recordUsage(req.user.id, { aiTokens: Number(result.usage && result.usage.total_tokens) || 0 });
    // A tool-call turn has empty `content` by design — it must survive the
    // response envelope, otherwise the client cannot dispatch anything.
    const message = { role: 'assistant', content: result.content };
    if (result.toolCalls && result.toolCalls.length) message.tool_calls = result.toolCalls;
    res.json({
        choices: [{ message, finish_reason: result.finishReason || null }],
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        requestId: result.requestId,
    });
}));

/** Legacy OpenRouter-compatible endpoint (same auth/policy as /chat). */
router.post('/chat/legacy', gate, asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { messages, model } = body;
    const legacyError = validateMessages(messages);
    if (legacyError) {
        return res.status(400).json({ error: legacyError });
    }
    // This endpoint always forwards to OpenRouter, so validate the model
    // against the OpenRouter allowlist — not the provider inferred from the
    // slug (an NVIDIA/Groq model must not slip through here).
    const policy = applyPolicy({ messages, model, provider: 'openrouter' });
    reserveAiQuota(req.user.id);
    const data = await proxyOpenRouter({ messages: policy.serverMessages, model: policy.model, userId: req.user.id });
    recordUsage(req.user.id, { aiTokens: Number(data && data.usage && data.usage.total_tokens) || 0 });
    res.json(data);
}));

module.exports = router;
