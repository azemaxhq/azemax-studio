const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { executeCode } = require('../services/execution/httpExecutor.cjs');
const { listDetectedRuntimes } = require('../services/execution/runtimeDetection.cjs');

const router = express.Router();

const MAX_CODE_BYTES = Number(process.env.MAX_CODE_BYTES) || 200 * 1024; // 200KB
const MAX_STDIN_BYTES = Number(process.env.MAX_STDIN_BYTES) || 32 * 1024; // 32KB

router.get('/runtimes', (_req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    const allowLocal = process.env.ALLOW_LOCAL_EXECUTION === 'true'
        ? true
        : process.env.ALLOW_LOCAL_EXECUTION === 'false'
            ? false
            : !isProd;
    // In production with local execution disabled, advertise Wandbox-backed languages still available
    if (!allowLocal) {
        // Return Wandbox-capable languages; localRuntimes length informs health
        const { WANDBOX_LANGUAGES } = require('../services/execution/constants.cjs');
        const list = Object.keys(WANDBOX_LANGUAGES).map(l => ({ language: l, version: '*', aliases: [l], runtime: 'wandbox' }));
        return res.json(list);
    }
    res.json(listDetectedRuntimes());
});

router.post('/execute', asyncHandler(async (req, res) => {
    // Input validation + size limits (beta abuse protection)
    const { language, files, stdin } = req.body || {};
    if (stdin && Buffer.byteLength(String(stdin), 'utf8') > MAX_STDIN_BYTES) {
        return res.status(413).json({ error: `stdin too large (max ${MAX_STDIN_BYTES} bytes)` });
    }
    if (files && Array.isArray(files)) {
        for (const f of files) {
            const content = String(f?.content || '');
            if (Buffer.byteLength(content, 'utf8') > MAX_CODE_BYTES) {
                return res.status(413).json({ error: `Code too large (max ${MAX_CODE_BYTES} bytes)` });
            }
        }
    }
    if (typeof language === 'string' && language.length > 50) {
        return res.status(400).json({ error: 'Invalid language' });
    }
    const result = await executeCode(req.body);
    res.json(result);
}));

module.exports = router;
