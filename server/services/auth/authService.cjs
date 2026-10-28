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
const { LIMITS } = require('../../config/index.cjs');

const EMAIL_RE = /^[^\s@]{1,128}@[^\s@]{1,128}\.[^\s@]{2,64}$/;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function conflict(message, code) {
    const err = new Error(message);
    err.status = 409;
    err.code = code;
    return err;
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
 * Account-linking safety:
 *  - A row already bound to a Firebase UID is NEVER re-bound to a different
 *    UID. The email fallback only adopts legacy rows with `firebase_uid IS NULL`.
 *  - An unverified identity may not adopt an existing row.
 *  - Promoting an unverified row to verified requires provider continuity:
 *    the token's sign-in provider must match the stored provider, or the
 *    stored provider must appear in the token's linked identities. A bare
 *    `email_verified` flag on a different provider is not proof of ownership.
 */
function syncFirebaseUser({
    uid,
    email,
    displayName,
    photoUrl,
    emailVerified = false,
    providerId = 'password',
    providerIds = [],
}) {
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
    const linkedProviders = new Set(
        (Array.isArray(providerIds) ? providerIds : [])
            .filter((p) => typeof p === 'string' && p)
            .map((p) => p.toLowerCase()),
    );
    linkedProviders.add(String(provider).toLowerCase());

    return transaction((instance) => {
        // 1. Existing identity for this provider UID — update in place.
        let row = instance.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(uid);

        if (row) {
            const storedProvider = row.provider || 'password';
            const upgrading = !Number(row.email_verified || 0) && verified === 1;
            if (upgrading && provider !== storedProvider && !linkedProviders.has(String(storedProvider).toLowerCase())) {
                throw conflict(
                    'This sign-in method is not linked to the account that owns this email. Sign in with the original method to verify it.',
                    'auth/provider-mismatch',
                );
            }

            const emailChanged = row.email !== normalizedEmail;
            if (emailChanged) {
                // Never move an email onto a row that another identity owns.
                const owner = instance.prepare('SELECT id FROM users WHERE email = ? AND id <> ?')
                    .get(normalizedEmail, row.id);
                if (owner) {
                    throw conflict(
                        'An account with this email already exists. Sign in with the method you originally used.',
                        'auth/email-already-in-use',
                    );
                }
            }

            // A changed address must carry its own verification state; an
            // unchanged address can never be downgraded by a stale token.
            const nextVerified = emailChanged
                ? verified
                : Math.max(Number(row.email_verified || 0), verified);
            // Only change the stored provider when the token proves continuity
            // (same provider, or the stored provider is linked to this UID).
            const providerContinuity = provider === storedProvider
                || linkedProviders.has(String(storedProvider).toLowerCase());
            const nextProvider = providerContinuity ? provider : storedProvider;

            const unchanged =
                !emailChanged &&
                (row.display_name || '') === name &&
                (row.photo_url || null) === photo &&
                Number(row.email_verified || 0) === nextVerified &&
                storedProvider === nextProvider;
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
            ).run(normalizedEmail, name, photo, nextVerified, nextProvider, now, now, row.id);
            return publicUser({
                ...row,
                email: normalizedEmail,
                display_name: name,
                photo_url: photo,
                email_verified: nextVerified,
                provider: nextProvider,
                last_login_at: now,
                updated_at: now,
            });
        }

        // 2. A row with this email exists but is not bound to this UID.
        row = instance.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
        if (row) {
            if (row.firebase_uid != null && row.firebase_uid !== '') {
                // Bound to a different Firebase identity. Email is not proof of
                // ownership; never overwrite the existing binding.
                throw conflict(
                    'An account with this email already exists. Sign in with the method you originally used.',
                    'auth/email-already-in-use',
                );
            }
            if (!verified) {
                throw conflict(
                    'An account with this email already exists. Verify the address, or sign in with the method you originally used.',
                    'auth/email-already-in-use',
                );
            }
            // Legacy pre-Firebase row (firebase_uid IS NULL) adopted by a
            // provider-verified identity.
            instance.prepare(
                `UPDATE users
                 SET firebase_uid = ?, display_name = COALESCE(?, display_name), photo_url = COALESCE(?, photo_url), email_verified = ?, provider = ?, last_login_at = ?, updated_at = ?
                 WHERE id = ?`
            ).run(uid, name, photo, verified, provider, now, now, row.id);
            return publicUser({
                ...row,
                firebase_uid: uid,
                display_name: name || row.display_name,
                photo_url: photo || row.photo_url,
                email_verified: verified,
                provider,
                last_login_at: now,
                updated_at: now,
            });
        }

        // 3. New user.
        const newId = crypto.randomUUID();
        // Credential storage is Firebase's job. This non-reversible random
        // placeholder satisfies the legacy NOT NULL column without ever holding
        // a password (and without embedding the Firebase UID in it).
        const placeholderHash = `!firebase:${crypto.randomBytes(32).toString('hex')}`;
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

/**
 * Atomically reserve one or more daily quota units BEFORE the expensive work.
 *
 * The conditional UPDATE is a single SQL statement, so concurrent requests
 * cannot both read "under quota" and then overshoot. Returns false when the
 * quota is exhausted; throws when the database is unavailable (fail closed —
 * an unverifiable quota must not become an unlimited quota).
 */
function reserveDaily(userId, { aiRequests = 0, executions = 0 } = {}) {
    if (!userId) return false;
    const ai = Math.max(0, Math.floor(Number(aiRequests) || 0));
    const exec = Math.max(0, Math.floor(Number(executions) || 0));
    if (ai === 0 && exec === 0) return true;

    const day = todayUtc();
    const QUOTA_EXCEEDED = Symbol('quota-exceeded');
    try {
        return transaction((instance) => {
            instance.prepare(
                'INSERT INTO usage_daily (user_id, day) VALUES (?, ?) ON CONFLICT (user_id, day) DO NOTHING',
            ).run(userId, day);

            if (ai > 0) {
                const res = instance.prepare(
                    `UPDATE usage_daily
                     SET ai_requests = ai_requests + ?
                     WHERE user_id = ? AND day = ? AND ai_requests + ? <= ?`,
                ).run(ai, userId, day, ai, LIMITS.AI_REQUESTS_PER_DAY);
                if (res.changes === 0) throw QUOTA_EXCEEDED;
            }
            if (exec > 0) {
                const res = instance.prepare(
                    `UPDATE usage_daily
                     SET executions = executions + ?
                     WHERE user_id = ? AND day = ? AND executions + ? <= ?`,
                ).run(exec, userId, day, exec, LIMITS.EXEC_REQUESTS_PER_DAY);
                if (res.changes === 0) throw QUOTA_EXCEEDED;
            }
            return true;
        });
    } catch (err) {
        if (err === QUOTA_EXCEEDED) return false;
        throw err;
    }
}

function getTodayUsage(userId) {
    // Deliberately does NOT swallow database errors: callers use this for
    // quota decisions, and an unknown quota must fail closed rather than
    // silently return zero usage.
    const row = getDb().prepare(
        'SELECT ai_requests, ai_tokens, executions FROM usage_daily WHERE user_id = ? AND day = ?',
    ).get(userId, todayUtc());
    return row || { ai_requests: 0, ai_tokens: 0, executions: 0 };
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
    reserveDaily,
    getTodayUsage,
    isAdminEmail,
};
