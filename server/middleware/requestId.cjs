/**
 * Request ID + access logging middleware.
 *
 * - Assigns req.id (crypto UUID). Honors an incoming X-Request-Id ONLY when it
 *   is a safe token (prevents log injection via crafted headers).
 * - Attaches a request-scoped structured logger as req.log.
 * - Emits one access-log line per completed request (method, path, status,
 *   latency, user id when authenticated). Query strings are logged WITHOUT
 *   values that look like secrets.
 */
const crypto = require('crypto');
const logger = require('../lib/logger.cjs');

const SAFE_REQ_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function requestIdMiddleware(req, res, next) {
    const incoming = req.headers['x-request-id'];
    req.id = (typeof incoming === 'string' && SAFE_REQ_ID_RE.test(incoming))
        ? incoming
        : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    req.log = logger.child({ reqId: req.id });
    const started = Date.now();
    res.on('finish', () => {
        const userId = req.user ? req.user.id : undefined;
        req.log.info('request', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            latencyMs: Date.now() - started,
            ...(userId ? { userId } : {}),
        });
    });
    next();
}

module.exports = { requestIdMiddleware };
