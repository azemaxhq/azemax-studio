const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN } = require('./config/index.cjs');
const { registerRoutes } = require('./routes/index.cjs');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler.cjs');

/** Lightweight in-memory rate limiter (no external dep). */
function createRateLimiter({ windowMs, max, message }) {
    const hits = new Map(); // ip -> { count, resetAt }
    const interval = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }, windowMs);
    if (interval.unref) interval.unref();
    return (req, res, next) => {
        // Only throttle AI/execute endpoints
        if (!req.path.startsWith('/api/ai') && !req.path.startsWith('/api/execute')) return next();
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (entry.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ error: message || 'Too many requests, slow down.' });
        }
        next();
    };
}

function createApp() {
    const app = express();

    // Security headers (helmet-lite without extra dep)
    app.use((_, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.removeHeader('X-Powered-By');
        next();
    });

    app.disable('x-powered-by');

    app.use(cors({
        origin: CORS_ORIGIN,
        credentials: true,
    }));
    // Reduced from 10mb — prevents large-payload DoS while still allowing chat/file ops
    app.use(express.json({ limit: '1mb' }));
    // HPP-lite: collapse duplicate query keys to last value
    app.use((req, _, next) => {
        for (const k of Object.keys(req.query)) {
            if (Array.isArray(req.query[k])) req.query[k] = req.query[k][req.query[k].length - 1];
        }
        next();
    });
    app.use(createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200, message: 'Rate limit exceeded. Try again later.' }));

    registerRoutes(app);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
