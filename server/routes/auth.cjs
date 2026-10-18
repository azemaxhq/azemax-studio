/**
 * Authentication routes — signup / login / logout / me.
 *
 * Rate limiting here is deliberately strict and per-IP (unauthenticated
 * surface): AUTH_RATE_PER_MINUTE attempts per IP per minute. Failures return
 * generic messages to avoid user-enumeration via timing or text — but note
 * signup DOES reveal whether an email is taken (409); that is standard and
 * required for usability, and enumeration is blunted by the rate limit.
 *
 * Session transport (beta): the httpOnly cookie is the primary credential,
 * but signup/login ALSO return the opaque session token in the JSON body.
 * The beta frontend (Vercel) and API (Render) are cross-site, and browsers
 * that block third-party cookies would otherwise drop the Set-Cookie and
 * strand the user at the login gate with no error. The client keeps the
 * token as a fallback and sends it as `Authorization: Bearer` (HTTP) or
 * `?token=` (WebSocket) — both verified server-side via verifySession.
 * Logout revokes whichever token the request carried.
 */
const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuth, SESSION_COOKIE } = require('../middleware/auth.cjs');
const { verifyIdToken } = require('../services/auth/firebaseAdmin.cjs');
const {
    createUser,
    findUserByEmail,
    publicUser,
    verifyPassword,
    createSession,
    revokeSession,
    syncFirebaseUser,
} = require('../services/auth/authService.cjs');
const { isProd } = require('../config/index.cjs');

const router = express.Router();

const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';

function setSessionCookie(res, token, expiresAt) {
    const parts = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        `Expires=${new Date(expiresAt).toUTCString()}`,
        'SameSite=' + (isProd ? 'None' : 'Lax'),
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
    const parts = [
        `${SESSION_COOKIE}=`,
        'Path=/',
        'HttpOnly',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'SameSite=' + (isProd ? 'None' : 'Lax'),
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Synchronize a Firebase Authentication identity with Azemax.
 *
 * The provider-issued ID token is verified with Firebase Admin. Every identity
 * field (uid, email, verification state, provider) is derived from the decoded
 * token — client-supplied ids/emails/roles are never trusted. The local user
 * record is created or reconciled idempotently, then a server session is
 * issued so the beta cross-site transport (cookie + Bearer fallback) works.
 */
router.post('/sync', asyncHandler(async (req, res) => {
    let idToken = req.body?.idToken;
    if (!idToken && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
        idToken = req.headers.authorization.slice(7).trim();
    }
    if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({ error: 'Missing authentication idToken' });
    }
    // A Firebase ID token is a compact JWT well under 8 KB. Reject anything
    // absurd before handing it to the verifier.
    if (idToken.length > 8192) {
        return res.status(400).json({ error: 'Invalid authentication idToken' });
    }

    let decoded;
    try {
        decoded = await verifyIdToken(idToken);
    } catch (err) {
        // Never echo provider error internals; surface a stable status only.
        const status = err && err.status ? err.status : 401;
        return res.status(status).json({
            error: status === 503
                ? 'Authentication provider is not configured on the server'
                : 'Invalid or expired authentication token',
            code: err && err.code ? err.code : 'auth/invalid-token',
        });
    }
    if (!decoded || !decoded.uid) {
        return res.status(401).json({ error: 'Invalid authentication token' });
    }

    const email = decoded.email;
    if (!email) {
        return res.status(400).json({ error: 'Token is missing a verified email claim' });
    }

    const user = (() => {
        try {
            return syncFirebaseUser({
                uid: decoded.uid,
                email,
                displayName: decoded.name,
                photoUrl: decoded.picture,
                emailVerified: Boolean(decoded.email_verified),
                providerId: (decoded.firebase && decoded.firebase.sign_in_provider) || 'password',
            });
        } catch (err) {
            // Unverified provider identity for an email that already belongs to
            // an account: refuse to merge (no account takeover via pre-hijack).
            const status = err && err.status ? err.status : 500;
            if (status === 409) {
                return res.status(409).json({
                    error: err.message || 'An account with this email already exists',
                    code: err.code || 'auth/email-already-in-use',
                });
            }
            throw err;
        }
    })();

    if (!user) {
        return res.status(500).json({ error: 'Could not synchronize the account' });
    }

    const { token, expiresAt } = createSession(user.id, clientIp(req));
    setSessionCookie(res, token, expiresAt);
    res.json({ user, token, expiresAt });
}));

router.post('/signup', asyncHandler(async (req, res) => {
    if (!ALLOW_SIGNUP) {
        return res.status(403).json({ error: 'Registration is disabled on this server' });
    }
    const { email, password, displayName } = req.body || {};
    const user = await createUser(email, password, displayName);
    const { token, expiresAt } = createSession(user.id, clientIp(req));
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user, token, expiresAt });
}));

router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const row = email ? findUserByEmail(email) : null;
    // Constant-shape failure: same status/message whether the email exists or
    // the password is wrong (prevents account enumeration).
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!ok || !row) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = publicUser(row);
    const { token, expiresAt } = createSession(user.id, clientIp(req));
    setSessionCookie(res, token, expiresAt);
    res.json({ user, token, expiresAt });
}));

router.post('/logout', (req, res) => {
    if (req.sessionToken) revokeSession(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
