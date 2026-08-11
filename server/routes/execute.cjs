const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { executeCode } = require('../services/execution/httpExecutor.cjs');
const { listDetectedRuntimes } = require('../services/execution/runtimeDetection.cjs');

const router = express.Router();

router.get('/runtimes', (_req, res) => {
    res.json(listDetectedRuntimes());
});

router.post('/execute', asyncHandler(async (req, res) => {
    const result = await executeCode(req.body);
    res.json(result);
}));

module.exports = router;
