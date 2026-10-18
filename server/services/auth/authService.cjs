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
const { getDb, nowIso, todayUtc, transaction } = require('../../db/index.cjs');
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
    return {
        id: row.id,
        email: row.email,
        displayName: row.display_name || null,
        photoUrl: row.photo_url || null,
        emailVerified: Boolean(row.email_verified),
        provider: row.provider || 'password',
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at || row.created_at,
    };
}

function findUserById(id) {
    if (!id) return null;
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(String(id));
    return row ? publicUser(row) : null;
}

function findUserByFirebaseUid(uid) {
    if (!uid) return null;
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(String(uid));
    return row ? publicUser(row) : null;
}

function syncFirebaseUser({ uid, email, displayName, photoUrl, emailVerified = false, providerId = 'password' }) {
    if (!uid) {
        const err = new Error('Missing Firebase UID');
        err.status = 400;
        throw err;
    }
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
        const err = new Error('Invalid email address from authentication provider');
        err.status = 400;
        throw err;
    }

    const now = nowIso();
    const name = typeof displayName === 'string' && displayName.trim()
        ? displayName.trim().slice(0, 80)
        : normalizedEmail.split('@')[0].slice(0, 80);
    const photo = typeof photoUrl === 'string' ? photoUrl.slice(0, 512) : null;
    const verified = emailVerified ? 1 : 0;
    const provider = providerId || 'password';

    return transaction((instance) => {
        // 1. Look for existing user by firebase_uid
        let row = instance.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(uid);

        if (row) {
            // Skip the write entirely when nothing material changed — repeated
            // /sync calls must not amplify DB writes.
            const unchanged =
                row.email === normalizedEmail &&
                (row.display_name || '') === name &&
                (row.photo_url || null) === (photo || null) &&
                Number(row.email_verified || 0) === verified &&
                (row.provider || 'password') === provider;
            if (unchanged) {
                return publicUser(row);
            }
            instance.prepare(
                `UPDATE users
                 SET email = ?, display_name = ?, photo_url = ?, email_verified = ?, provider = ?, last_login_at = ?, updated_at = ?
                 WHERE id = ?`
            ).run(normalizedEmail, name, photo, verified, provider, now, now, row.id);
            return publicUser({
                ...row,
                email: normalizedEmail,
                display_name: name,
                photo_url: photo,
                email_verified: verified,
                provider,
                last_login_at: now,
                updated_at: now,
            });
        }

        // 2. Look for existing user with matching email.
        //
        //    Linking an existing (email/password) account to a Firebase identity
        //    is only safe when the PROVIDER has proven ownership of that email.
        //    Firebase password sign-ups are unverified, so a token with
        //    email_verified === false must never be allowed to adopt a
        //    pre-existing account for the same address — that would let anyone
        //    who merely typed a victim's email ("account takeover" via account
        //    pre-hijacking) gain access. Verified emails (Google, or a
        //    confirmed password account) may link.
        row = instance.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
        if (row) {
            if (!verified) {
                const conflict = new Error(
                    'An account with this email already exists. Verify the address, or sign in with the method you originally used.',
                );
                conflict.status = 409;
                conflict.code = 'auth/email-already-in-use';
                throw conflict;
            }
            const nextVerified = Math.max(Number(row.email_verified || 0), verified);
            instance.prepare(
                `UPDATE users
                 SET firebase_uid = ?, display_name = COALESCE(?, display_name), photo_url = COALESCE(?, photo_url), email_verified = ?, provider = ?, last_login_at = ?, updated_at = ?
                 WHERE id = ?`
            ).run(uid, name, photo, nextVerified, provider, now, now, row.id);
            return publicUser({
                ...row,
                firebase_uid: uid,
                display_name: name || row.display_name,
                photo_url: photo || row.photo_url,
                email_verified: nextVerified,
                provider,
                last_login_at: now,
                updated_at: now,
            });
        }

        // 3. Create new user
        const newId = crypto.randomUUID();
        const placeholderHash = `firebase:${provider}:${uid}`;
        instance.prepare(
            `INSERT INTO users (id, firebase_uid, email, password_hash, display_name, photo_url, email_verified, provider, created_at, updated_at, last_login_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId, uid, normalizedEmail, placeholderHash, name, photo, verified, provider, now, now, now);

        return publicUser({
            id: newId,
            firebase_uid: uid,
            email: normalizedEmail,
            display_name: name,
            photo_url: photo,
            email_verified: verified,
            provider,
            created_at: now,
            updated_at: now,
            last_login_at: now,
        });
    });
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
                'INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).run(id, e, passwordHash, name, now, now, now);
        } catch (err) {
            if (err && String(err.message).includes('UNIQUE')) {
                const conflict = new Error('An account with this email already exists');
                conflict.status = 409;
                throw conflict;
            }
            throw err;
        }
        return publicUser({ id, email: e, display_name: name, created_at: now, last_login_at: now });
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
        `SELECT s.token_hash, s.user_id, s.expires_at, s.last_used_at, u.id, u.email, u.display_name, u.photo_url, u.email_verified, u.provider, u.firebase_uid, u.created_at, u.last_login_at
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
    return publicUser(row);
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

// ---- Auth-bypass dev user (DISABLE_AUTH=true only) ---------------------------
// Fixed, deterministic identity so frontend + backend + WS all agree on the
// same owner id, and SQLite FK constraints (projects.owner_id, usage_daily)
// stay satisfied. The row is created lazily on first use; real users and
// their data are untouched, so unsetting DISABLE_AUTH restores login cleanly.
const DEV_USER_ID = 'local-dev';
const DEV_USER_EMAIL = 'local-dev@azemax.local';

function ensureDevUser() {
    const db = getDb();
    let row = null;
    try {
        row = db.prepare('SELECT * FROM users WHERE id = ?').get(DEV_USER_ID);
    } catch { row = null; }
    if (!row) {
        const now = nowIso();
        try {
            // NOTE: the bypass identity is marked verified. It is not a real
            // account and cannot receive mail, so leaving it unverified would
            // strand the UI on the verification pane and print a non-deliverable
            // address (local-dev@azemax.local) as if a message had been sent.
            db.prepare(
                'INSERT INTO users (id, email, password_hash, display_name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).run(DEV_USER_ID, DEV_USER_EMAIL, 'disabled:DISABLE_AUTH', 'Local Dev', 1, now, now);
            row = db.prepare('SELECT * FROM users WHERE id = ?').get(DEV_USER_ID);
        } catch (err) {
            // Another worker may have inserted concurrently, or email taken by
            // a legacy row — fall back to whatever exists for the email.
            try {
                row = db.prepare('SELECT * FROM users WHERE email = ?').get(DEV_USER_EMAIL)
                    || db.prepare('SELECT * FROM users WHERE id = ?').get(DEV_USER_ID);
            } catch { row = null; }
            if (!row) throw err;
        }
    } else if (!Number(row.email_verified || 0)) {
        // Heal rows created before the flag was added so the bypass never
        // surfaces a verification prompt for a fixture address.
        try {
            db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(nowIso(), DEV_USER_ID);
            row = db.prepare('SELECT * FROM users WHERE id = ?').get(DEV_USER_ID);
        } catch { /* non-fatal */ }
    }
    return publicUser(row);
}

module.exports = {
    DEV_USER_ID,
    DEV_USER_EMAIL,
    ensureDevUser,
    MIN_PASSWORD_LEN,
    normalizeEmail,
    validateCredentials,
    hashPassword,
    verifyPassword,
    createUser,
    findUserByEmail,
    findUserById,
    findUserByFirebaseUid,
    syncFirebaseUser,
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
