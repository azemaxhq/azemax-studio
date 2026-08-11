const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/index.cjs');
const { registerRoutes } = require('./routes/index.cjs');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler.cjs');

function createApp() {
    const app = express();

    app.use(cors({
        origin: CORS_ORIGIN,
        credentials: true,
    }));
    app.use(express.json({ limit: '10mb' }));

    registerRoutes(app);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
