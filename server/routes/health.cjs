const express = require('express');
const { ALLOW_LOCAL_EXECUTION, ALLOW_SHELL } = require('../config/index.cjs');
const { getDb } = require('../db/index.cjs');

const router = express.Router();

// Public liveness: ONLY operational facts. Provider configuration, execution
// modes, and runtime inventories are intentionally NOT exposed (they are
// reconnaissance for attackers: which paid keys exist, whether host exec is on).
router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'ai-code-editor-api',
        timestamp: new Date().toISOString(),
    });
});

// Readiness: verifies dependencies (database). Load balancers / Render health
// checks should use this path. Returns 503 until the DB is reachable.
router.get('/ready', (_req, res) => {
    try {
        const db = getDb();
        db.prepare('SELECT 1 AS ok').get();
        res.json({
            status: 'ready',
            service: 'ai-code-editor-api',
            timestamp: new Date().toISOString(),
            execution: {
                // Modes only (booleans), never keys or paths.
                sandboxedExecution: !ALLOW_LOCAL_EXECUTION,
                shell: ALLOW_SHELL,
            },
        });
    } catch (_err) {
        res.status(503).json({ status: 'not-ready', service: 'ai-code-editor-api' });
    }
});

module.exports = router;
