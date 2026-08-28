const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { sendChat, streamChat, proxyOpenRouter, listModels } = require('../services/ai/chatService.cjs');

const router = express.Router();

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

router.post('/chat', asyncHandler(async (req, res) => {
    const { messages, model, temperature, maxTokens, responseLength, stream, task, allowFallback } = req.body;

    const validationError = validateMessages(messages);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    if (stream) {
        await streamChat({ messages, model, temperature, maxTokens, responseLength, res, req, task, allowFallback });
        return;
    }

    const result = await sendChat({ messages, model, temperature, maxTokens, responseLength, task, allowFallback, requestId: req.id });
    res.json({
        choices: [{ message: { role: 'assistant', content: result.content } }],
        model: result.model,
        provider: result.provider,
        usage: result.usage,
        requestId: result.requestId,
    });
}));

/** Legacy OpenRouter-compatible endpoint */
router.post('/chat/legacy', asyncHandler(async (req, res) => {
    const { messages, model } = req.body;
    const legacyError = validateMessages(messages);
    if (legacyError) {
        return res.status(400).json({ error: legacyError });
    }
    const data = await proxyOpenRouter({ messages, model });
    res.json(data);
}));

module.exports = router;
