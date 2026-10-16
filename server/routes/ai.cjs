const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuthOrPublicBeta, isAnonymousRequest } = require('../middleware/auth.cjs');
const { sendChat, streamChat, proxyOpenRouter, listModels } = require('../services/ai/chatService.cjs');
const { inferProvider } = require('../services/ai/aiClient.cjs');
const {
    validateRequestedModel,
    buildServerMessages,
    sanitizeTools,
    sanitizeToolChoice,
} = require('../services/ai/aiPolicy.cjs');
const { getTodayUsage, recordUsage } = require('../services/auth/authService.cjs');
const { LIMITS } = require('../config/index.cjs');

const router = express.Router();

// AI spends server provider keys — authenticated users pass through; anonymous
// public-beta visitors are accepted under a tighter IP-attributed daily quota
// (see requireAuthOrPublicBeta). Input validation + model policy below apply
// identically to both, so there is no unrestricted anonymous proxy.
//
// NOTE: the gate is applied PER-ROUTE (never `router.use`) so a future
// prefix-less mount can never mint anonymous identities for other routers.
const betaGate = requireAuthOrPublicBeta;

router.get('/models', betaGate, (_req, res) => {
    res.json({ models: listModels() });
});

const MAX_MESSAGES = 50;
const MAX_CONTENT_CHARS = 20_000;
const MAX_TOTAL_CHARS = 100_000;

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

/** Daily per-user quota gate (denial-of-wallet backstop). Anonymous beta traffic
 *  gets a tighter cap than authenticated users. */
function checkDailyQuota(userId, isAnonymous) {
    const usage = getTodayUsage(userId);
    const cap = isAnonymous ? LIMITS.AI_ANON_REQUESTS_PER_DAY : LIMITS.AI_REQUESTS_PER_DAY;
    if (usage.ai_requests >= cap) {
        const err = new Error(isAnonymous
            ? `Daily guest AI limit reached (${cap}). Sign in for a higher limit, or try again tomorrow.`
            : `Daily AI request limit reached (${cap}). Try again tomorrow.`);
        err.status = 429;
        throw err;
    }
}

/**
 * Apply the server AI policy to untrusted client input:
 * - requested model must be on the provider allowlist (or omitted)
 * - maxTokens capped to the absolute server ceiling
 * - messages rebuilt with the server-pinned system prompt (client `system`
 *   roles are demoted — history cannot override server behavior)
 */
function applyPolicy({ messages, model, maxTokens, tools, toolChoice }) {
    if (model !== undefined && model !== null) {
        validateRequestedModel(model, inferProvider);
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
    }
    return {
        serverMessages: buildServerMessages(messages),
        model,
        maxTokens: cappedTokens,
        tools: serverTools,
        toolChoice: serverTools ? sanitizeToolChoice(toolChoice) : 'auto',
    };
}

router.post('/chat', betaGate, asyncHandler(async (req, res) => {
    const { messages, model, temperature, maxTokens, responseLength, stream, task, allowFallback, tools, toolChoice } = req.body;

    const validationError = validateMessages(messages);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }
    checkDailyQuota(req.user.id, isAnonymousRequest(req));
    const policy = applyPolicy({ messages, model, maxTokens, tools, toolChoice });

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
        recordUsage(req.user.id, { aiRequests: 1, aiTokens: streamedTokens });
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
    recordUsage(req.user.id, { aiRequests: 1, aiTokens: Number(result.usage && result.usage.total_tokens) || 0 });
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
router.post('/chat/legacy', betaGate, asyncHandler(async (req, res) => {
    const { messages, model } = req.body;
    const legacyError = validateMessages(messages);
    if (legacyError) {
        return res.status(400).json({ error: legacyError });
    }
    checkDailyQuota(req.user.id, isAnonymousRequest(req));
    const policy = applyPolicy({ messages, model });
    const data = await proxyOpenRouter({ messages: policy.serverMessages, model: policy.model, userId: req.user.id });
    recordUsage(req.user.id, { aiRequests: 1, aiTokens: Number(data && data.usage && data.usage.total_tokens) || 0 });
    res.json(data);
}));

module.exports = router;
