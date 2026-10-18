const express = require('express');
const cors = require('cors');
const { CORS_ORIGIN, LIMITS, isProd } = require('./config/index.cjs');
const { registerRoutes } = require('./routes/index.cjs');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler.cjs');
const { requestIdMiddleware } = require('./middleware/requestId.cjs');
const { authenticateRequest } = require('./middleware/auth.cjs');
const logger = require('./lib/logger.cjs');

/**
 * In-memory sliding-window rate limiter (no external dep).
 *
 * Keyed by authenticated user id when available, otherwise IP — so one bad
 * actor cannot burn the shared IP budget of users behind NAT, and one user
 * cannot evade limits by rotating IPs.
 *
 * NOTE: single-instance memory. Behind multiple replicas this must move to
 * Redis (documented in the production report). Daily quotas in SQLite
 * (usage_daily) are the cross-instance backstop.
 */
function createPolicyLimiter({ windowMs, max, keyOf, message, scope }) {
    const hits = new Map(); // key -> { count, resetAt }
    const interval = setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }, Math.min(windowMs, 60000));
    if (interval.unref) interval.unref();
    return (req, res, next) => {
        if (scope && !scope(req)) return next();
        let key;
        try {
            key = keyOf(req);
        } catch {
            return next();
        }
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

function identityKey(prefix) {
    return (req) => {
        if (req.user) return `${prefix}:u:${req.user.id}`;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        return `${prefix}:ip:${ip}`;
    };
}

function createApp() {
    const app = express();

    // Security headers (helmet-lite without extra dep). CSP is set for API
    // responses too (defense in depth; the frontend sets its own stricter CSP).
    app.use((_, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (isProd) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        res.removeHeader('X-Powered-By');
        next();
    });

    app.disable('x-powered-by');

    if (isProd) {
        app.set('trust proxy', 1);
    }

    app.use(cors({
        origin: CORS_ORIGIN,
        credentials: true,
    }));

    // Request IDs + access logging come first so every log line correlates.
    app.use(requestIdMiddleware);
    // Attach identity (non-rejecting); individual routes enforce requireAuth.
    app.use(authenticateRequest);

    app.use(express.json({ limit: '1mb' }));
    // HPP-lite: collapse duplicate query keys to last value
    app.use((req, _, next) => {
        for (const k of Object.keys(req.query)) {
            if (Array.isArray(req.query[k])) req.query[k] = req.query[k][req.query[k].length - 1];
        }
        next();
    });

    // Per-endpoint policies. Auth endpoints: strict per-IP (unauthenticated).
    app.use(createPolicyLimiter({
        windowMs: 60 * 1000,
        max: LIMITS.AUTH_RATE_PER_MINUTE,
        keyOf: (req) => `auth:ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
        message: 'Too many authentication attempts. Try again later.',
        scope: (req) => req.path.startsWith('/api/auth/sync'),
    }));
    // AI: per-user (or per-IP for unauthenticated, though routes require auth).
    app.use(createPolicyLimiter({
        windowMs: 60 * 1000,
        max: LIMITS.AI_REQUESTS_PER_MINUTE,
        keyOf: identityKey('ai'),
        message: 'AI rate limit exceeded. Try again shortly.',
        scope: (req) => req.path.startsWith('/api/ai/'),
    }));
    // Execution: per-user.
    app.use(createPolicyLimiter({
        windowMs: 60 * 1000,
        max: LIMITS.EXEC_REQUESTS_PER_MINUTE,
        keyOf: identityKey('exec'),
        message: 'Execution rate limit exceeded. Try again shortly.',
        scope: (req) => req.path.startsWith('/api/execute'),
    }));
    // Projects / account sync writes hit disk/DB: per-user, generous but bounded.
    app.use(createPolicyLimiter({
        windowMs: 60 * 1000,
        max: 180,
        keyOf: identityKey('proj'),
        message: 'Too many sync requests. Try again shortly.',
        scope: (req) => req.path.startsWith('/api/projects') || req.path.startsWith('/api/account/'),
    }));

    registerRoutes(app);

    app.use(notFoundHandler);
    app.use(errorHandler);

    // Log the effective (non-secret) configuration once per boot.
    try {
        const { publicSummary } = require('./config/index.cjs');
        logger.info('app configured', publicSummary());
    } catch { /* ignore */ }

    return app;
}

module.exports = { createApp };
