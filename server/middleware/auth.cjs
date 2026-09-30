/**
 * Authentication / authorization middleware.
 *
 * Identity source (in order):
 *   1. httpOnly cookie `azemax_session`
 *   2. `Authorization: Bearer <token>` header (non-browser clients)
 *
 * Authorization is ALWAYS derived server-side from the verified session.
 * Never trust userId / owner / email from body, query, or client storage.
 */
const { verifySession, isAdminEmail } = require('../services/auth/authService.cjs');

const SESSION_COOKIE = 'azemax_session';

function tokenFromRequest(req) {
    // Cookie first (browser SPA). Simple parse — no cookie lib needed.
    const header = req.headers.cookie;
    if (typeof header === 'string') {
        for (const part of header.split(';')) {
            const idx = part.indexOf('=');
            if (idx === -1) continue;
            const name = part.slice(0, idx).trim();
            if (name === SESSION_COOKIE) {
                const value = decodeURIComponent(part.slice(idx + 1).trim());
                if (value) return value;
            }
        }
    }
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        const token = auth.slice(7).trim();
        if (token) return token;
    }
    return null;
}

/**
 * Attaches req.user (public user object) when a valid session exists.
 * Does NOT reject — use requireAuth() for protected routes so /api/health
 * and other public endpoints can share the middleware safely.
 */
function authenticateRequest(req, _res, next) {
    try {
        const token = tokenFromRequest(req);
        req.sessionToken = token;
        req.user = token ? verifySession(token) : null;
    } catch {
        req.user = null;
    }
    next();
}

/** Reject unauthenticated requests with 401 (no information leak). */
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

/** Reject non-admin users with 403. Admins: ADMIN_EMAILS env allowlist. */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!isAdminEmail(req.user.email)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

module.exports = {
    SESSION_COOKIE,
    tokenFromRequest,
    authenticateRequest,
    requireAuth,
    requireAdmin,
};
