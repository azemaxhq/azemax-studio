const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { sendChat, streamChat, proxyOpenRouter, listModels } = require('../services/ai/chatService.cjs');

const router = express.Router();

router.get('/models', (_req, res) => {
    res.json({ models: listModels() });
});

router.post('/chat', asyncHandler(async (req, res) => {
    const { messages, model, temperature, responseLength, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages array is required' });
    }

    if (stream) {
        await streamChat({ messages, model, temperature, responseLength, res });
        return;
    }

    const result = await sendChat({ messages, model, temperature, responseLength });
    res.json({
        choices: [{ message: { role: 'assistant', content: result.content } }],
        model: result.model,
        usage: result.usage,
    });
}));

/** Legacy OpenRouter-compatible endpoint */
router.post('/chat/legacy', asyncHandler(async (req, res) => {
    const { messages, model } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
    }
    const data = await proxyOpenRouter({ messages, model });
    res.json(data);
}));

module.exports = router;
