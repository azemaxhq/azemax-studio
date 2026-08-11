function notFoundHandler(req, res) {
    res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
    });
}

function errorHandler(err, req, res, _next) {
    const status = err.status || err.statusCode || 500;
    console.error(`[API] ${req.method} ${req.path}:`, err.message || err);

    res.status(status).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && err.details ? { details: err.details } : {}),
    });
}

module.exports = { notFoundHandler, errorHandler };
