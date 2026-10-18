const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireVerifiedEmail } = require('../middleware/auth.cjs');
const { executeCode } = require('../services/execution/httpExecutor.cjs');
const { listDetectedRuntimes } = require('../services/execution/runtimeDetection.cjs');
const { getTodayUsage, recordUsage } = require('../services/auth/authService.cjs');
const { LIMITS } = require('../config/index.cjs');

const router = express.Router();

// Code execution spends server resources — every route requires a verified,
// authenticated account (401/403 before any spawn). Input validation + size
// limits below apply to every caller.
//
// NOTE: this router is mounted WITHOUT a path prefix (see routes/index.cjs), so
// the gate is applied PER-ROUTE (never `router.use`) to keep it from leaking
// onto unrelated routers.
const gate = requireVerifiedEmail;

const MAX_CODE_BYTES = LIMITS.MAX_CODE_BYTES;
const MAX_STDIN_BYTES = LIMITS.MAX_STDIN_BYTES;

router.get('/runtimes', gate, (_req, res) => {
    const { ALLOW_LOCAL_EXECUTION } = require('../config/index.cjs');
    // In production with local execution disabled, advertise Wandbox-backed languages still available
    if (!ALLOW_LOCAL_EXECUTION) {
        // Return Wandbox-capable languages; localRuntimes length informs health
        const { WANDBOX_LANGUAGES } = require('../services/execution/constants.cjs');
        const list = Object.keys(WANDBOX_LANGUAGES).map(l => ({ language: l, version: '*', aliases: [l], runtime: 'wandbox' }));
        return res.json(list);
    }
    res.json(listDetectedRuntimes());
});

router.post('/execute', gate, asyncHandler(async (req, res) => {
    const cap = LIMITS.EXEC_REQUESTS_PER_DAY;
    const usage = getTodayUsage(req.user.id);
    if (usage.executions >= cap) {
        return res.status(429).json({ error: `Daily execution limit reached (${cap}). Try again tomorrow.` });
    }
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
    recordUsage(req.user.id, { executions: 1 });
    res.json(result);
}));

module.exports = router;
