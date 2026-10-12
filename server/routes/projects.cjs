/**
 * Project routes — authentication + ownership enforced on EVERY operation.
 *
 * Authorization model: the owner is ALWAYS req.user.id (server-verified
 * session). The client never supplies ownership. A user can only ever
 * list/read/write/delete their own projects; any other id yields 404
 * (not 403 — project existence itself is not disclosed across users).
 *
 * PUBLIC BETA: this router intentionally keeps strict requireAuth (NOT the
 * public-beta gate). Anonymous visitors never touch it — their workspaces
 * persist locally in the browser — so anonymous users cannot read, overwrite,
 * or delete any other user's private projects.
 */
const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuth } = require('../middleware/auth.cjs');
const projectStore = require('../services/projects/projectStore.cjs');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
    res.json({ projects: projectStore.listProjects(req.user.id) });
}));

router.post('/', asyncHandler(async (req, res) => {
    const project = projectStore.createProject(req.user.id, req.body || {});
    res.status(201).json(project);
}));

router.get('/:id', asyncHandler(async (req, res) => {
    res.json(projectStore.getProject(req.user.id, req.params.id));
}));

router.put('/:id', asyncHandler(async (req, res) => {
    res.json(projectStore.saveProject(req.user.id, req.params.id, req.body || {}));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(projectStore.deleteProject(req.user.id, req.params.id));
}));

module.exports = router;
