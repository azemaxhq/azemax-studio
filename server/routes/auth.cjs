/**
 * Authentication routes — Firebase identity synchronization surface.
 *
 * There is no local login/signup and no server session here: Firebase
 * Authentication owns credentials, and the client presents a Firebase ID token
 * as `Authorization: Bearer` for every protected request. These routes exist
 * only to reconcile the verified Firebase identity with the application
 * database and to read the current application profile.
 *
 *   POST /api/auth/sync    verify a Firebase ID token, upsert the app user
 *   GET  /api/auth/me      return the current app user (Bearer ID token)
 *   POST /api/auth/logout  acknowledge client-side sign-out
 *
 * Every identity field comes from the Admin-verified token. Client-supplied
 * ids, emails, verification flags, roles, and ownership are never trusted.
 */
const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuth, bearerTokenFromRequest } = require('../middleware/auth.cjs');
const { verifyIdToken } = require('../services/auth/firebaseAdmin.cjs');
const { syncFirebaseUser } = require('../services/auth/authService.cjs');
const { FIREBASE_CHECK_REVOKED } = require('../config/index.cjs');

const router = express.Router();

function providerIdsFromDecoded(decoded) {
    const identities = decoded && decoded.firebase && decoded.firebase.identities;
    if (!identities || typeof identities !== 'object') return [];
    return Object.keys(identities);
}

router.post('/sync', asyncHandler(async (req, res) => {
    // Accept the token in the body (initial exchange) or the Authorization
    // header (idempotent re-sync), matching the two client call sites.
    let idToken = req.body && req.body.idToken;
    if (!idToken) idToken = bearerTokenFromRequest(req);

    if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({ error: 'Missing authentication idToken' });
    }
    // A Firebase ID token is a compact JWT well under 8 KB.
    if (idToken.length > 8192) {
        return res.status(400).json({ error: 'Invalid authentication idToken' });
    }

    let decoded;
    try {
        decoded = await verifyIdToken(idToken, FIREBASE_CHECK_REVOKED);
    } catch (err) {
        // Never echo provider internals; surface a stable status only.
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
    if (typeof decoded.email !== 'string' || !decoded.email) {
        return res.status(400).json({ error: 'Token is missing a verified email claim' });
    }

    let user;
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
    } catch (err) {
        const status = err && err.status ? err.status : 500;
        if (status === 409) {
            return res.status(409).json({
                error: err.message || 'An account with this email already exists',
                code: err.code || 'auth/email-already-in-use',
            });
        }
        throw err;
    }

    if (!user) {
        return res.status(500).json({ error: 'Could not synchronize the account' });
    }
    res.json({ user });
}));

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

/**
 * Sign-out is performed by the Firebase client SDK, which discards the ID and
 * refresh tokens on the device. This endpoint performs no server-side session
 * revocation (there is no server session), so it must never be described as
 * invalidating previously issued ID tokens — those expire on their own.
 */
router.post('/logout', (req, res) => {
    res.json({ ok: true });
});

module.exports = router;
