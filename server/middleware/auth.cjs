/**
 * Authentication / authorization middleware.
 *
 * Identity source: a Firebase Authentication ID token presented as
 * `Authorization: Bearer <idToken>`. The token is verified with the Firebase
 * Admin SDK on every request; its claims are the ONLY trusted identity source.
 *
 * Authorization is ALWAYS derived server-side from the verified identity.
 * Never trust userId / firebaseUid / email / emailVerified / role / owner from
 * the body, query string, or client storage.
 *
 * Fail-closed: when Firebase Admin is not configured, no token can be verified,
 * so `authenticateRequest` leaves `req.user` null and every protected route
 * rejects with 401. Missing configuration never grants access.
 */
const {
    findUserByFirebaseUid,
    syncFirebaseUser,
    isAdminEmail,
} = require('../services/auth/authService.cjs');
const { verifyIdToken, isFirebaseConfigured } = require('../services/auth/firebaseAdmin.cjs');
const { FIREBASE_CHECK_REVOKED } = require('../config/index.cjs');

function providerIdsFromDecoded(decoded) {
    const identities = decoded && decoded.firebase && decoded.firebase.identities;
    if (!identities || typeof identities !== 'object') return [];
    return Object.keys(identities);
}

function normalizedEmail(value) {
    return String(value || '').trim().toLowerCase();
}

/** Extract a bearer credential from the Authorization header (case-insensitive scheme). */
function bearerTokenFromRequest(req) {
    const auth = req && req.headers && req.headers.authorization;
    if (typeof auth !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!match) return null;
    const token = match[1].trim();
    return token || null;
}

/**
 * Attach req.user (public application user) when a valid Firebase ID token is
 * present. Never rejects — protected routes call requireAuth()/requireVerifiedEmail().
 */
async function authenticateRequest(req, _res, next) {
    req.user = null;
    try {
        const token = bearerTokenFromRequest(req);
        if (!token || token.length > 8192 || !isFirebaseConfigured()) {
            return next();
        }
        const decoded = await verifyIdToken(token, FIREBASE_CHECK_REVOKED);
        if (!decoded || !decoded.uid) {
            return next();
        }
        let user = findUserByFirebaseUid(decoded.uid);
        // Provision / refresh the local row only when it is missing or a
        // security-relevant claim changed. Never write on every request.
        const verificationChanged = Boolean(user) && Boolean(user.emailVerified) !== Boolean(decoded.email_verified);
        const emailChanged = Boolean(user) && Boolean(decoded.email)
            && normalizedEmail(decoded.email) !== normalizedEmail(user.email);
        if ((!user || verificationChanged || emailChanged) && typeof decoded.email === 'string' && decoded.email) {
            try {
                user = syncFirebaseUser({
                    uid: decoded.uid,
                    email: decoded.email,
                    displayName: decoded.name,
                    photoUrl: decoded.picture,
                    emailVerified: Boolean(decoded.email_verified),
                    providerId: (decoded.firebase && decoded.firebase.sign_in_provider) || 'password',
                    providerIds: providerIdsFromDecoded(decoded),
                });
            } catch {
                // A rejected sync (unsafe email link, provider mismatch, or a
                // collision with another account) must not authenticate.
                user = null;
            }
        }
        req.user = user;
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

/** Require a provider-verified email address for product operations. */
function requireVerifiedEmail(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.user.emailVerified) {
        return res.status(403).json({ error: 'Email verification required', code: 'auth/unverified-email' });
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
    bearerTokenFromRequest,
    authenticateRequest,
    requireAuth,
    requireVerifiedEmail,
    requireAdmin,
};
