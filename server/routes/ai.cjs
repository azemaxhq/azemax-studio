const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuth } = require('../middleware/auth.cjs');
const { sendChat, streamChat, proxyOpenRouter, listModels } = require('../services/ai/chatService.cjs');
const { inferProvider } = require('../services/ai/aiClient.cjs');
const {
    validateRequestedModel,
    buildServerMessages,
} = require('../services/ai/aiPolicy.cjs');
const { getTodayUsage, recordUsage } = require('../services/auth/authService.cjs');
const { LIMITS } = require('../config/index.cjs');

const router = express.Router();

// All AI endpoints require an authenticated user (server keys are spent here).
router.use(requireAuth);

router.get('/models', (_req, res) => {
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
        if (m.role && !['system', 'user', 'assistant'].includes(m.role)) return `invalid role: ${m.role}`;
    }
    return null;
}

/** Daily per-user quota gate (denial-of-wallet backstop). */
function checkDailyQuota(userId) {
    const usage = getTodayUsage(userId);
    if (usage.ai_requests >= LIMITS.AI_REQUESTS_PER_DAY) {
        const err = new Error(`Daily AI request limit reached (${LIMITS.AI_REQUESTS_PER_DAY}). Try again tomorrow.`);
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
function applyPolicy({ messages, model, maxTokens }) {
    if (model !== undefined && model !== null) {
        validateRequestedModel(model, inferProvider);
    }
    const cappedTokens = maxTokens === undefined || maxTokens === null
        ? maxTokens
        : Math.min(Math.max(1, Math.floor(Number(maxTokens) || 0)), LIMITS.AI_MAX_TOKENS_ABSOLUTE);
    return { serverMessages: buildServerMessages(messages), model, maxTokens: cappedTokens };
}

router.post('/chat', asyncHandler(async (req, res) => {
    const { messages, model, temperature, maxTokens, responseLength, stream, task, allowFallback } = req.body;

    const validationError = validateMessages(messages);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }
    checkDailyQuota(req.user.id);
    const policy = applyPolicy({ messages, model, maxTokens });

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
            userId: req.user.id,
            onUsage: (u) => { streamedTokens = Number(u && u.total_tokens) || 0; },
        });
        recordUsage(req.user.id, { aiRequests: 1, aiTokens: streamedTokens });
        return;
    }

    const result = await sendChat({
        messages: policy.serverMessages,
        model: policy.model,
        temperature,
        maxTokens: policy.maxTokens,
        responseLength,
        task,
        allowFallback,
        requestId: req.id,
        userId: req.user.id,
    });
    recordUsage(req.user.id, { aiRequests: 1, aiTokens: Number(result.usage && result.usage.total_tokens) || 0 });
    res.json({
        choices: [{ message: { role: 'assistant', content: result.content } }],
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        requestId: result.requestId,
    });
}));

/** Legacy OpenRouter-compatible endpoint (same auth/policy as /chat). */
router.post('/chat/legacy', asyncHandler(async (req, res) => {
    const { messages, model } = req.body;
    const legacyError = validateMessages(messages);
    if (legacyError) {
        return res.status(400).json({ error: legacyError });
    }
    checkDailyQuota(req.user.id);
    const policy = applyPolicy({ messages, model });
    const data = await proxyOpenRouter({ messages: policy.serverMessages, model: policy.model, userId: req.user.id });
    recordUsage(req.user.id, { aiRequests: 1, aiTokens: Number(data && data.usage && data.usage.total_tokens) || 0 });
    res.json(data);
}));

module.exports = router;
