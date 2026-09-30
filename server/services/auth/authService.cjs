/**
 * Authentication service — email + password, server-side sessions.
 *
 * - Passwords: scrypt (N=16384, r=8, p=1, 64-byte hash), unique 16-byte salt,
 *   timing-safe verification. Never logged, never returned.
 * - Sessions: 32-byte opaque tokens (base64url). Only the SHA-256 hash is
 *   stored. Tokens are bearer credentials — transmitted via httpOnly cookie
 *   (primary) or Authorization: Bearer (non-browser clients).
 * - Expiry: sliding SESSION_TTL_MS, refreshed at most once per hour per
 *   session to avoid write amplification.
 * - No roles yet: every authenticated user is equal; `is_admin` is reserved
 *   for a future migration. Admin endpoints check an explicit allowlist via
 *   requireAdmin (env ADMIN_EMAILS).
 */
const crypto = require('crypto');
const { promisify } = require('util');
const { getDb, nowIso, todayUtc } = require('../../db/index.cjs');
const { LIMITS, isProd } = require('../../config/index.cjs');

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const MIN_PASSWORD_LEN = 10;
const SESSION_TOUCH_MIN_MS = 3600 * 1000; // refresh expiry at most hourly

const EMAIL_RE = /^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@]{2,64}$/;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function validateCredentials(email, password) {
    const e = normalizeEmail(email);
    if (!EMAIL_RE.test(e)) {
        const err = new Error('Invalid email address');
        err.status = 400;
        throw err;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
        const err = new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
        err.status = 400;
        throw err;
    }
    if (password.length > 256) {
        const err = new Error('Password too long');
        err.status = 400;
        throw err;
    }
    return e;
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const derived = await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    try {
        const parts = String(stored).split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
        const N = Number(parts[1]);
        const r = Number(parts[2]);
        const p = Number(parts[3]);
        if (![N, r, p].every(Number.isInteger) || N <= 0 || r <= 0 || p <= 0) return false;
        const salt = Buffer.from(parts[4], 'base64');
        const expected = Buffer.from(parts[5], 'base64');
        if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;
        const derived = await scryptAsync(String(password), salt, KEY_LEN, { N, r, p });
        return crypto.timingSafeEqual(derived, expected);
    } catch {
        return false;
    }
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function publicUser(row) {
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.display_name || null, createdAt: row.created_at };
}

function createUser(email, password, displayName) {
    const e = validateCredentials(email, password);
    return hashPassword(password).then((passwordHash) => {
        const db = getDb();
        const id = crypto.randomUUID();
        const now = nowIso();
        const name = typeof displayName === 'string' && displayName.trim()
            ? displayName.trim().slice(0, 80)
            : e.split('@')[0].slice(0, 80);
        try {
            db.prepare(
                'INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(id, e, passwordHash, name, now, now);
        } catch (err) {
            if (err && String(err.message).includes('UNIQUE')) {
                const conflict = new Error('An account with this email already exists');
                conflict.status = 409;
                throw conflict;
            }
            throw err;
        }
        return publicUser({ id, email: e, display_name: name, created_at: now });
    });
}

function findUserByEmail(email) {
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) || null;
}

function createSession(userId, ip) {
    const db = getDb();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + LIMITS.SESSION_TTL_MS).toISOString();
    db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_used_at, ip) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(hashToken(token), userId, new Date(now).toISOString(), expiresAt, new Date(now).toISOString(), ip ? String(ip).slice(0, 64) : null);
    return { token, expiresAt };
}

/** Returns the public user for a valid, unexpired token — or null. */
function verifySession(token) {
    if (!token || typeof token !== 'string' || token.length < 20) return null;
    const db = getDb();
    const row = db.prepare(
        `SELECT s.token_hash, s.user_id, s.expires_at, s.last_used_at, u.id, u.email, u.display_name, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
    ).get(hashToken(token));
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
        try { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash); } catch { /* ignore */ }
        return null;
    }
    // Sliding expiry, throttled to one write per hour per session.
    const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (Date.now() - lastUsed > SESSION_TOUCH_MIN_MS) {
        try {
            db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?')
                .run(nowIso(), new Date(Date.now() + LIMITS.SESSION_TTL_MS).toISOString(), row.token_hash);
        } catch { /* ignore */ }
    }
    return { id: row.user_id, email: row.email, displayName: row.display_name || null, createdAt: row.created_at };
}

function revokeSession(token) {
    if (!token) return;
    try {
        getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(String(token)));
    } catch { /* ignore */ }
}

function revokeAllSessions(userId) {
    try {
        getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    } catch { /* ignore */ }
}

/** Delete expired sessions. Called periodically; returns rows removed. */
function pruneExpiredSessions() {
    try {
        const res = getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
        return Number(res.changes || 0);
    } catch {
        return 0;
    }
}

function recordUsage(userId, { aiRequests = 0, aiTokens = 0, executions = 0 } = {}) {
    if (!userId) return;
    try {
        getDb().prepare(
            `INSERT INTO usage_daily (user_id, day, ai_requests, ai_tokens, executions)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, day) DO UPDATE SET
               ai_requests = ai_requests + excluded.ai_requests,
               ai_tokens = ai_tokens + excluded.ai_tokens,
               executions = executions + excluded.executions`,
        ).run(userId, todayUtc(), aiRequests, aiTokens, executions);
    } catch { /* usage accounting must never break requests */ }
}

function getTodayUsage(userId) {
    try {
        const row = getDb().prepare(
            'SELECT ai_requests, ai_tokens, executions FROM usage_daily WHERE user_id = ? AND day = ?',
        ).get(userId, todayUtc());
        return row || { ai_requests: 0, ai_tokens: 0, executions: 0 };
    } catch {
        return { ai_requests: 0, ai_tokens: 0, executions: 0 };
    }
}

function isAdminEmail(email) {
    const allow = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return allow.includes(String(email || '').toLowerCase());
}

module.exports = {
    MIN_PASSWORD_LEN,
    normalizeEmail,
    validateCredentials,
    hashPassword,
    verifyPassword,
    createUser,
    findUserByEmail,
    publicUser,
    createSession,
    verifySession,
    revokeSession,
    revokeAllSessions,
    pruneExpiredSessions,
    recordUsage,
    getTodayUsage,
    isAdminEmail,
    isProd,
};
