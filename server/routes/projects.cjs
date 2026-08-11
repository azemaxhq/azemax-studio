const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const workspaceStore = require('../services/projects/workspaceStore.cjs');

const router = express.Router();

router.get('/', asyncHandler(async (_req, res) => {
    res.json({ projects: workspaceStore.listWorkspaces() });
}));

router.post('/', asyncHandler(async (req, res) => {
    const workspace = workspaceStore.createWorkspace(req.body);
    res.status(201).json(workspace);
}));

router.get('/:id', asyncHandler(async (req, res) => {
    res.json(workspaceStore.getWorkspace(req.params.id));
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const workspace = workspaceStore.saveWorkspace(req.params.id, req.body);
    res.json(workspace);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(workspaceStore.deleteWorkspace(req.params.id));
}));

module.exports = router;
