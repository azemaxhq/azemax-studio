const express = require('express');
const healthRoutes = require('./health.cjs');
const aiRoutes = require('./ai.cjs');
const executeRoutes = require('./execute.cjs');
const projectRoutes = require('./projects.cjs');

function registerRoutes(app) {
    const api = express.Router();

    api.use(healthRoutes);
    api.use('/ai', aiRoutes);
    api.use(executeRoutes);
    api.use('/projects', projectRoutes);

    app.use('/api', api);
}

module.exports = { registerRoutes };
