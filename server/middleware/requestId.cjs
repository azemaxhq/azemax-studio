/**
 * Request ID + access logging middleware.
 *
 * - Assigns req.id from a server-generated crypto UUID. An incoming
 *   X-Request-Id is recorded as `req.clientRequestId` for correlation only; it
 *   is NEVER used as a server key (clients could collide it with an in-flight
 *   AI stream id and abort another user's request).
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
    req.id = crypto.randomUUID();
    req.clientRequestId = (typeof incoming === 'string' && SAFE_REQ_ID_RE.test(incoming))
        ? incoming
        : undefined;
    res.setHeader('X-Request-Id', req.id);
    if (req.clientRequestId) res.setHeader('X-Client-Request-Id', req.clientRequestId);
    req.log = logger.child({
        reqId: req.id,
        ...(req.clientRequestId ? { clientRequestId: req.clientRequestId } : {}),
    });
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
