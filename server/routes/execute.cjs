const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireVerifiedEmail } = require('../middleware/auth.cjs');
const { executeCode } = require('../services/execution/httpExecutor.cjs');
const { listDetectedRuntimes } = require('../services/execution/runtimeDetection.cjs');
const { reserveDaily } = require('../services/auth/authService.cjs');
const { LIMITS } = require('../config/index.cjs');
const { byteLength } = require('../lib/bytes.cjs');

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
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { language, files, stdin } = body;

    // Input validation + size limits (beta abuse protection). Validate BEFORE
    // reserving quota so malformed requests do not consume a daily execution.
    if (typeof language !== 'string' || !language.trim() || language.length > 50) {
        return res.status(400).json({ error: 'Invalid language' });
    }
    if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'files must be a non-empty array' });
    }
    if (stdin !== undefined && typeof stdin !== 'string') {
        return res.status(400).json({ error: 'stdin must be a string' });
    }
    if (typeof stdin === 'string' && byteLength(stdin) > MAX_STDIN_BYTES) {
        return res.status(413).json({ error: `stdin too large (max ${MAX_STDIN_BYTES} bytes)` });
    }
    if (Array.isArray(files)) {
        for (const file of files) {
            if (!file || typeof file !== 'object' || Array.isArray(file)) {
                return res.status(400).json({ error: 'Each file must be an object' });
            }
            if (file.content !== undefined && typeof file.content !== 'string') {
                return res.status(400).json({ error: 'File content must be a string' });
            }
            if (byteLength(file.content || '') > MAX_CODE_BYTES) {
                return res.status(413).json({ error: `Code too large (max ${MAX_CODE_BYTES} bytes)` });
            }
        }
    }

    // Reserve atomically before doing any work. The unit is charged on attempt,
    // including provider/compiler failures and client aborts.
    const allowed = reserveDaily(req.user.id, { executions: 1 });
    if (!allowed) {
        return res.status(429).json({
            error: `Daily execution limit reached (${LIMITS.EXEC_REQUESTS_PER_DAY}). Try again tomorrow.`,
        });
    }

    const result = await executeCode(body);
    res.json(result);
}));

module.exports = router;
