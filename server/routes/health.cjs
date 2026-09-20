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
            nvidia: Boolean(AI_MODELS.nvidia.apiKey),
            groq: Boolean(AI_MODELS.groq.apiKey),
            openRouter: Boolean(AI_MODELS.openRouter.apiKey),
            huggingFace: Boolean(AI_MODELS.huggingFace.apiKey),
            kilo: Boolean(AI_MODELS.kiloCode.apiKey),
        },
        execution: {
            localRuntimes: listDetectedRuntimes().length,
            localExecution: process.env.ALLOW_LOCAL_EXECUTION === 'true'
                ? true
                : process.env.ALLOW_LOCAL_EXECUTION === 'false'
                    ? false
                    : process.env.NODE_ENV !== 'production',
            shell: process.env.ALLOW_SHELL === 'true'
                ? true
                : process.env.ALLOW_SHELL === 'false'
                    ? false
                    : process.env.NODE_ENV !== 'production',
        },
    });
});

module.exports = router;
