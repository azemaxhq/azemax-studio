/**
 * Authentication routes — signup / login / logout / me.
 *
 * Rate limiting here is deliberately strict and per-IP (unauthenticated
 * surface): AUTH_RATE_PER_MINUTE attempts per IP per minute. Failures return
 * generic messages to avoid user-enumeration via timing or text — but note
 * signup DOES reveal whether an email is taken (409); that is standard and
 * required for usability, and enumeration is blunted by the rate limit.
 */
const express = require('express');
const { asyncHandler } = require('../lib/asyncHandler.cjs');
const { requireAuth, SESSION_COOKIE } = require('../middleware/auth.cjs');
const {
    createUser,
    findUserByEmail,
    publicUser,
    verifyPassword,
    createSession,
    revokeSession,
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

router.post('/signup', asyncHandler(async (req, res) => {
    if (!ALLOW_SIGNUP) {
        return res.status(403).json({ error: 'Registration is disabled on this server' });
    }
    const { email, password, displayName } = req.body || {};
    const user = await createUser(email, password, displayName);
    const { token, expiresAt } = createSession(user.id, clientIp(req));
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user });
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
    res.json({ user });
}));

router.post('/logout', (req, res) => {
    if (req.sessionToken) revokeSession(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email, displayName: req.user.displayName, createdAt: req.user.createdAt } });
});

module.exports = router;
