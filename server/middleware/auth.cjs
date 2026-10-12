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
const { verifySession, isAdminEmail, ensureDevUser } = require('../services/auth/authService.cjs');
const { DISABLE_AUTH, PUBLIC_BETA } = require('../config/index.cjs');

const SESSION_COOKIE = 'azemax_session';

/**
 * Anonymous public-beta identity prefix. The `anon:` prefix guarantees an
 * anonymous id can NEVER collide with a real user UUID (or the local-dev
 * bypass id), so ownership checks in projectStore/terminalManager isolate
 * anonymous traffic from private user data by construction.
 */
const ANON_ID_PREFIX = 'anon:';

/** True for server-minted anonymous public-beta identities. */
function isAnonymousId(id) {
    return typeof id === 'string' && id.startsWith(ANON_ID_PREFIX);
}

/** True when the request was attributed to an anonymous beta identity. */
function isAnonymousRequest(req) {
    return Boolean(req && (req.isAnonymous || (req.user && isAnonymousId(req.user.id))));
}

function clientIpOf(req) {
    const raw = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    return String(raw).slice(0, 64);
}

/**
 * Mint an anonymous identity bound to the request's network identity.
 * The id is derived SERVER-SIDE from the connection IP — a client-supplied
 * userId/body/query field is never trusted. Sanitized to a safe alphabet so
 * it is usable as a usage_daily/project owner key without injection risk.
 */
function buildAnonymousUser(req) {
    const ip = clientIpOf(req).replace(/[^a-zA-Z0-9.:_-]/g, '').slice(0, 48) || 'unknown';
    return {
        id: `${ANON_ID_PREFIX}${ip}`,
        email: null,
        displayName: 'Guest',
        createdAt: new Date(0).toISOString(),
        isAnonymous: true,
    };
}

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
    // Reversible login bypass: DISABLE_AUTH=true injects the fixed local dev
    // user so every request is authenticated. Real sessions still resolve
    // first when present; the dev user is only the fallback.
    if (DISABLE_AUTH) {
        try {
            const token = tokenFromRequest(req);
            req.sessionToken = token;
            req.user = token ? verifySession(token) : null;
            if (!req.user) req.user = ensureDevUser();
        } catch {
            try { req.user = ensureDevUser(); } catch { req.user = null; }
        }
        next();
        return;
    }
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
    if (DISABLE_AUTH) {
        // Ensure req.user is populated even if authenticateRequest was skipped
        // (e.g. mounted routers/tests). Never 401 in bypass mode.
        if (!req.user) {
            try { req.user = ensureDevUser(); } catch { /* ignore */ }
        }
        next();
        return;
    }
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

/**
 * Public-beta gate for resource-spending endpoints (AI, code execution).
 *
 * - Authenticated sessions pass through untouched (full quotas, real owner).
 * - Unauthenticated requests are accepted ONLY when PUBLIC_BETA is enabled,
 *   attributed to a server-minted IP-bound anonymous identity with tighter
 *   daily quotas (enforced by the route). No shared identity is created and
 *   no private data becomes reachable: the `anon:` id cannot own or address
 *   any real user's resources.
 * - When PUBLIC_BETA=false this behaves exactly like requireAuth (401).
 */
function requireAuthOrPublicBeta(req, res, next) {
    if (req.user && !isAnonymousId(req.user.id)) {
        next();
        return;
    }
    if (DISABLE_AUTH) {
        if (!req.user) {
            try { req.user = ensureDevUser(); } catch { /* ignore */ }
        }
        next();
        return;
    }
    if (PUBLIC_BETA) {
        try {
            req.user = buildAnonymousUser(req);
            req.isAnonymous = true;
        } catch {
            return res.status(401).json({ error: 'Authentication required' });
        }
        next();
        return;
    }
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

/** Reject non-admin users with 403. Admins: ADMIN_EMAILS env allowlist. */
function requireAdmin(req, res, next) {
    if (DISABLE_AUTH && !req.user) {
        try { req.user = ensureDevUser(); } catch { /* ignore */ }
    }
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
    ANON_ID_PREFIX,
    tokenFromRequest,
    authenticateRequest,
    requireAuth,
    requireAuthOrPublicBeta,
    requireAdmin,
    isAnonymousId,
    isAnonymousRequest,
    buildAnonymousUser,
};
