const express = require('express');
const { AI_MODELS } = require('../config/index.cjs');
const { listDetectedRuntimes } = require('../services/execution/runtimeDetection.cjs');

const router = express.Router();

router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'ai-code-editor-api',
        timestamp: new Date().toISOString(),
        ai: {
            groq: Boolean(AI_MODELS.groq.apiKey),
            openRouter: Boolean(AI_MODELS.openRouter.apiKey),
            huggingFace: Boolean(AI_MODELS.huggingFace.apiKey),
        },
        execution: {
            localRuntimes: listDetectedRuntimes().length,
        },
    });
});

module.exports = router;
