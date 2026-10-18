/**
 * Account sync routes — `/api/account/state`.
 *
 * Every operation is authorized by the verified Firebase identity on the
 * request. The owner is `req.user.id`; client-supplied ids/emails are ignored.
 * Only the closed section allowlist in accountStateStore is accepted.
 */
const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireVerifiedEmail } = require('../middleware/auth.cjs');
const accountStateStore = require('../services/account/accountStateStore.cjs');

const router = express.Router();

router.use(requireVerifiedEmail);

router.get('/state', asyncHandler(async (req, res) => {
    res.json(accountStateStore.listState(req.user.id));
}));

router.get('/state/:section', asyncHandler(async (req, res) => {
    res.json(accountStateStore.getSection(req.user.id, req.params.section));
}));

router.put('/state/:section', asyncHandler(async (req, res) => {
    const data = req.body && typeof req.body === 'object' ? req.body.data : undefined;
    res.json(accountStateStore.saveSection(req.user.id, req.params.section, data));
}));

router.delete('/state/:section', asyncHandler(async (req, res) => {
    res.json(accountStateStore.deleteSection(req.user.id, req.params.section));
}));

module.exports = router;
