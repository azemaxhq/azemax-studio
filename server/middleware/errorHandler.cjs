const { AIError, AI_ERROR_CODES } = require('../services/ai/aiError.cjs');

function notFoundHandler(req, res) {
    res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
    });
}

function errorHandler(err, req, res, _next) {
    // Typed AI provider failures serialize as a structured `error` object
    // (code / provider / model / status / retryable / userMessage). The raw
    // developer message and stack are never exposed to the client.
    if (err instanceof AIError) {
        const status = err.status
            || (err.code === AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED ? 503 : 502);
        console.error(`[API] ${req.method} ${req.path}: AI ${err.code} (${err.provider}/${err.model})`, err.message || err);
        return res.status(status).json({
            error: err.toJSON(),
        });
    }

    const status = err.status || err.statusCode || 500;
    const isProd = process.env.NODE_ENV === 'production';
    console.error(`[API] ${req.method} ${req.path}:`, err.message || err);

    res.status(status).json({
        error: isProd ? (status >= 500 ? 'Internal server error' : (err.message || 'Request failed')) : (err.message || 'Internal server error'),
        ...(!isProd && err.details ? { details: err.details } : {}),
        ...(!isProd && err.stack ? { stack: err.stack } : {}),
    });
}

module.exports = { notFoundHandler, errorHandler };