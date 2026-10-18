/**
 * Application user service — Firebase-backed identity only.
 *
 * Azemax does NOT own credentials. Firebase Authentication is the sole
 * authoritative identity provider (email/password + Google); the application
 * database stores ONLY app-specific metadata keyed by the verified Firebase
 * UID. There is deliberately no password hashing, no password verification,
 * and no custom session token here — adding either would create a second
 * identity system that Firebase already owns.
 *
 * Responsibilities:
 *  - idempotent synchronization of a verified Firebase identity into `users`
 *  - public-profile projection (never leaks internal linkage or secrets)
 *  - per-user daily usage accounting (quota backstop)
 *  - admin allowlist check (env ADMIN_EMAILS)
 */
const crypto = require('crypto');
const { getDb, nowIso, todayUtc, transaction } = require('../../db/index.cjs');

const EMAIL_RE = /^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@]{2,64}$/;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
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

/**
 * Create or reconcile the application user for a VERIFIED Firebase identity.
 *
 * Every field is derived from server-verified token claims — this function is
 * never called with client-supplied identity. Idempotent: repeated calls for
 * the same UID update only changed fields inside a single transaction and
 * never create duplicate rows (a unique index on firebase_uid backs this up).
 *
 * Account-linking safety: an existing account is adopted by a Firebase identity
 * ONLY when the provider has proven ownership of the email (email_verified).
 * An unverified password signup may claim any address, so it can never adopt a
 * pre-existing account (account pre-hijack defence) — such a sync is rejected
 * with 409 and no rows are written.
 */
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
    const photo = typeof photoUrl === 'string' && photoUrl.trim() ? photoUrl.trim().slice(0, 512) : null;
    const verified = emailVerified ? 1 : 0;
    const provider = providerId || 'password';

    return transaction((instance) => {
        // 1. Existing identity for this provider UID — update in place.
        let row = instance.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(uid);

        if (row) {
            const unchanged =
                row.email === normalizedEmail &&
                (row.display_name || '') === name &&
                (row.photo_url || null) === photo &&
                Number(row.email_verified || 0) === verified &&
                (row.provider || 'password') === provider;
            if (unchanged) {
                // Still record the sign-in timestamp, but only when it moves.
                instance.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
                    .run(now, now, row.id);
                return publicUser({ ...row, last_login_at: now, updated_at: now });
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

        // 2. A different identity already owns this email.
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

        // 3. New user.
        const newId = crypto.randomUUID();
        // Credential storage is Firebase's job. This non-reversible placeholder
        // satisfies the legacy NOT NULL column without ever holding a password.
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
    normalizeEmail,
    publicUser,
    findUserById,
    findUserByFirebaseUid,
    syncFirebaseUser,
    recordUsage,
    getTodayUsage,
    isAdminEmail,
};
