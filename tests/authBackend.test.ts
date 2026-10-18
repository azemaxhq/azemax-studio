/**
 * Backend tests for Firebase Authentication synchronization, user data model,
 * session management, authorization middleware, and the /api/auth surface.
 *
 * Real Firebase is NEVER contacted: a deterministic verifier is injected via
 * the firebaseAdmin test seam, so the HTTP layer, middleware, and user-sync
 * logic run as in production but with controlled token claims. The database is
 * a throwaway temp file (never the development/production DB), and DISABLE_AUTH
 * is forced off so the middleware tests exercise the real code path rather than
 * the local-dev bypass from .env.
 *
 * Covered:
 *  - syncFirebaseUser: create, idempotent repeat, email-link, verify upgrade,
 *    duplicate prevention, no plaintext secrets, no internal UID leakage
 *  - session lifecycle (create / verify / revoke) with schema-v2 fields
 *  - requireVerifiedEmail gating
 *  - Firebase Admin: configured state + classified token failures
 *  - POST /api/auth/sync (missing / invalid / expired / outage / no-email /
 *    valid), cookie issuance, idempotency, and raw ID-token bearer fallback
 *  - GET /api/auth/me, POST /api/auth/logout (+ revocation)
 *  - per-IP rate limiting on the auth surface, safe error responses
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Environment — set BEFORE any server module is imported (config reads env at
// import time). dotenv never overrides pre-set vars, so these win over .env.
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.DISABLE_AUTH = 'false';
process.env.PUBLIC_BETA = 'true';
// Above the number of functional requests this suite makes, so only the
// dedicated rate-limit test (a separate app + request loop) trips 429.
process.env.AUTH_RATE_PER_MINUTE = '30';
process.env.AUTH_SECRET = 'test-secret-0123456789abcdef-test-secret';
process.env.FIREBASE_PROJECT_ID = 'azemax-auth-test';
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'azemax-auth-test-'));
process.env.DATA_DIR = TMP_DATA;
process.env.DATABASE_PATH = path.join(TMP_DATA, 'test.db');

// Firebase Admin module + deterministic verifier seam (no network).
const fbMod = await import('../server/services/auth/firebaseAdmin.cjs');
const fb = (fbMod as unknown as { default?: typeof fbMod }).default ?? fbMod;

const VERIFIED_CLAIMS = {
    uid: 'firebase-uid-verified',
    email: 'Verified.User@Example.com',
    name: 'Verified User',
    picture: 'https://example.com/avatar.png',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
};
const UNVERIFIED_CLAIMS = {
    uid: 'firebase-uid-unverified',
    email: 'pending.user@example.com',
    name: 'Pending User',
    email_verified: false,
    firebase: { sign_in_provider: 'password' },
};

fb.__setVerifyIdTokenForTests(async (idToken: string) => {
    // The request middleware only attempts Firebase verification for
    // JWT-shaped tokens (three dot-separated segments) — real Firebase ID
    // tokens always are. The auth routes call the verifier directly, so they
    // accept any opaque test token.
    if (idToken === 'jwt.verified.sig' || idToken === 'id-token-verified') return { ...VERIFIED_CLAIMS };
    if (idToken === 'id-token-unverified') return { ...UNVERIFIED_CLAIMS };
    if (idToken === 'id-token-no-email') return { uid: 'uid-no-email', email_verified: false, firebase: { sign_in_provider: 'password' } };
    if (idToken === 'id-token-conflict') {
        return {
            uid: 'conflict-attacker-uid',
            email: 'conflict.victim@example.com',
            email_verified: false,
            firebase: { sign_in_provider: 'password' },
        };
    }
    if (idToken === 'id-token-expired') {
        const err = new Error('Firebase ID token has expired');
        (err as { status?: number; code?: string }).status = 401;
        (err as { status?: number; code?: string }).code = 'auth/id-token-expired';
        throw err;
    }
    if (idToken === 'id-token-revoked') {
        const err = new Error('Firebase ID token has been revoked');
        (err as { status?: number; code?: string }).status = 401;
        (err as { status?: number; code?: string }).code = 'auth/id-token-revoked';
        throw err;
    }
    if (idToken === 'id-token-outage') {
        const err = new Error('Auth provider unavailable');
        (err as { status?: number; code?: string }).status = 503;
        (err as { status?: number; code?: string }).code = 'auth/not-configured';
        throw err;
    }
    const err = new Error('Invalid ID token');
    (err as { status?: number; code?: string }).status = 401;
    (err as { status?: number; code?: string }).code = 'auth/invalid-token';
    throw err;
});

const svcMod = await import('../server/services/auth/authService.cjs');
const svc = (svcMod as unknown as { default?: typeof svcMod }).default ?? svcMod;
const {
    syncFirebaseUser,
    findUserByFirebaseUid,
    findUserById,
    ensureDevUser,
    createSession,
    verifySession,
    revokeSession,
} = svc;

const authMod = await import('../server/middleware/auth.cjs');
const auth = (authMod as unknown as { default?: typeof authMod }).default ?? authMod;
const { requireVerifiedEmail } = auth;

const dbMod = await import('../server/db/index.cjs');
const db = (dbMod as unknown as { default?: typeof dbMod }).default ?? dbMod;
const rawDb = (db as unknown as {
    getDb: () => {
        prepare: (sql: string) => {
            get: (...args: unknown[]) => Record<string, unknown> | undefined;
            run: (...args: unknown[]) => unknown;
        };
    };
}).getDb();

// ---------------------------------------------------------------------------
// Firebase Admin Service
// ---------------------------------------------------------------------------
{
    check('firebaseAdmin: project id present -> configured', fb.isFirebaseConfigured() === true);

    const decoded = await fb.verifyIdToken('id-token-verified');
    check('firebaseAdmin: returns decoded claims', decoded.uid === VERIFIED_CLAIMS.uid && decoded.email === VERIFIED_CLAIMS.email);

    let expiredOk = false;
    try { await fb.verifyIdToken('id-token-expired'); } catch (e) {
        const err = e as { status?: number; code?: string };
        expiredOk = err.status === 401 && err.code === 'auth/id-token-expired';
    }
    check('firebaseAdmin: expired token -> 401', expiredOk);

    let revokedOk = false;
    try { await fb.verifyIdToken('id-token-revoked'); } catch (e) {
        const err = e as { status?: number; code?: string };
        revokedOk = err.status === 401 && err.code === 'auth/id-token-revoked';
    }
    check('firebaseAdmin: revoked token -> 401', revokedOk);

    let invalidOk = false;
    try { await fb.verifyIdToken('nonsense'); } catch (e) {
        invalidOk = (e as { status?: number }).status === 401;
    }
    check('firebaseAdmin: unknown token -> 401', invalidOk);
}

// ---------------------------------------------------------------------------
// Firebase User Synchronization
// ---------------------------------------------------------------------------
function countByUid(uid: string): number {
    const row = rawDb.prepare('SELECT COUNT(*) AS count FROM users WHERE firebase_uid = ?').get(uid);
    return Number(row?.count ?? 0);
}

{
    const testUid = 'fb-test-verified';
    const testEmail = 'firebase.developer@example.com';

    const created = syncFirebaseUser({
        uid: testUid,
        email: 'Firebase.Developer@Example.COM', // normalized on write
        displayName: 'Firebase Developer',
        photoUrl: 'https://example.com/avatar.png',
        emailVerified: true,
        providerId: 'google.com',
    });

    check('creates user with generated UUID', Boolean(created && created.id && created.id.length > 20));
    check('stores normalized email', created.email === testEmail);
    check('stores displayName', created.displayName === 'Firebase Developer');
    check('stores photoUrl', created.photoUrl === 'https://example.com/avatar.png');
    check('stores emailVerified', created.emailVerified === true);
    check('stores provider', created.provider === 'google.com');
    // The provider UID is internal linkage metadata and is never returned in a
    // public profile response; it is reachable only via the service lookup.
    check('does not expose internal firebaseUid in the public profile',
        !('firebaseUid' in created) && !('firebase_uid' in created));
    check('never exposes the password hash', !('password_hash' in created) && !('passwordHash' in created));

    const foundByUid = findUserByFirebaseUid(testUid);
    check('findUserByFirebaseUid returns synced user', Boolean(foundByUid && foundByUid.id === created.id));

    const foundById = findUserById(created.id);
    check('findUserById returns synced user', Boolean(foundById && foundById.email === testEmail));

    // Stored credential is a non-reversible placeholder, never a password.
    const stored = rawDb.prepare('SELECT password_hash FROM users WHERE firebase_uid = ?').get(testUid);
    check('stores no plaintext password (placeholder only)', String(stored?.password_hash).startsWith('firebase:'));

    // Idempotent re-sync updates fields without duplicates.
    const updated = syncFirebaseUser({
        uid: testUid,
        email: testEmail,
        displayName: 'Updated Developer',
        photoUrl: 'https://example.com/new-avatar.png',
        emailVerified: true,
        providerId: 'google.com',
    });
    check('preserves user ID on re-sync', updated.id === created.id);
    check('updates displayName', updated.displayName === 'Updated Developer');
    check('updates photoUrl', updated.photoUrl === 'https://example.com/new-avatar.png');
    check('no duplicate rows for the same firebase_uid', countByUid(testUid) === 1);
}

{
    // Verification can be upgraded but the reverse never silently downgrades a
    // linked account.
    const up = syncFirebaseUser({ uid: 'svc-uid-verify', email: 'upgrade@example.com', emailVerified: false, providerId: 'password' });
    check('starts unverified', up.emailVerified === false);
    const up2 = syncFirebaseUser({ uid: 'svc-uid-verify', email: 'upgrade@example.com', emailVerified: true, providerId: 'password' });
    check('verification upgrade persists', up2.emailVerified === true && up2.id === up.id);
}

{
    // Account linking by verified email.
    const preExistingEmail = 'legacy.person@example.com';
    const preExistingId = `pre-${Date.now()}`;
    rawDb.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(preExistingId, preExistingEmail, 'scrypt$dummyhash', 'Legacy User', new Date().toISOString(), new Date().toISOString());

    const linkedUid = 'fb-link-legacy';
    const linked = syncFirebaseUser({
        uid: linkedUid,
        email: 'Legacy.Person@Example.com',
        displayName: 'Legacy User Linked',
        photoUrl: 'https://example.com/linked.png',
        emailVerified: true,
        providerId: 'google.com',
    });
    check('links to pre-existing user id', linked.id === preExistingId);
    check('associates new firebase_uid', findUserByFirebaseUid(linkedUid)?.id === preExistingId);
    check('email link keeps a single row for the uid', countByUid(linkedUid) === 1);

    // A second provider identity with the SAME email resolves to the same
    // application user (no duplicate account created).
    const second = syncFirebaseUser({ uid: 'fb-link-legacy-2', email: preExistingEmail, emailVerified: true, providerId: 'google.com' });
    check('same email never creates a second account', second.id === preExistingId);

    // Validation: rejects missing or invalid inputs.
    let missingUidThrown = false;
    try { syncFirebaseUser({ uid: '', email: 'valid@example.com' }); } catch { missingUidThrown = true; }
    check('rejects missing UID', missingUidThrown);

    let invalidEmailThrown = false;
    try { syncFirebaseUser({ uid: 'some-uid', email: 'not-an-email' }); } catch { invalidEmailThrown = true; }
    check('rejects invalid email address', invalidEmailThrown);
}

{
    // Pre-hijack defence: an UNVERIFIED provider identity (e.g. a fresh Firebase
    // password sign-up, which can claim any address without proving it) must
    // never adopt a pre-existing account that already owns that email.
    const victimEmail = 'prehijack.victim@example.com';
    const victimId = 'victim-account';
    rawDb.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(victimId, victimEmail, 'scrypt$victim', 'Victim', 1, new Date().toISOString(), new Date().toISOString());

    let conflict: { status?: number; code?: string } | null = null;
    try {
        syncFirebaseUser({ uid: 'attacker-uid', email: victimEmail, emailVerified: false, providerId: 'password' });
    } catch (e) {
        conflict = e as { status?: number; code?: string };
    }
    check('unverified email cannot adopt an existing account (no pre-hijack)', conflict?.status === 409);
    check('rejected sync leaves the victim uid unlinked', findUserByFirebaseUid('attacker-uid') === null);
    check('victim row is untouched by the rejected sync', findUserById(victimId)?.id === victimId);

    // A PROVIDER-VERIFIED email may link (Google proves ownership).
    const linked = syncFirebaseUser({ uid: 'attacker-uid', email: victimEmail, emailVerified: true, providerId: 'google.com' });
    check('verified email links to the pre-existing account', linked.id === victimId && findUserByFirebaseUid('attacker-uid')?.id === victimId);
}

{
    // The development auth-bypass identity is NOT a real account and can never
    // receive mail — it must always report as verified so the UI never prompts
    // for verification of its fixture address (local-dev@azemax.local).
    const dev = ensureDevUser();
    check('dev bypass identity is id local-dev', dev.id === 'local-dev');
    check('dev bypass identity reports emailVerified (no bogus verification prompt)', dev.emailVerified === true);
}

{
    // Concurrent-style duplicate prevention: many syncs in one tick converge on
    // one row (BEGIN IMMEDIATE serializes the writes).
    const results = await Promise.all(
        Array.from({ length: 8 }, () => Promise.resolve().then(() => syncFirebaseUser({
            uid: 'svc-uid-race', email: 'race@example.com', emailVerified: true, providerId: 'google.com',
        }))),
    );
    const ids = new Set(results.map((u) => u.id));
    check('no duplicate rows under concurrent sync', ids.size === 1 && countByUid('svc-uid-race') === 1);
}

{
    // Database-level uniqueness backstop on the provider identity.
    let uniqueEnforced = false;
    try {
        rawDb.prepare('INSERT INTO users (id, firebase_uid, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run('dup-id', 'fb-test-verified', 'dup-email@example.com', 'x', new Date().toISOString(), new Date().toISOString());
    } catch (e) {
        uniqueEnforced = /UNIQUE/i.test(String((e as Error).message));
    }
    check('unique index rejects duplicate firebase_uid', uniqueEnforced);
}

// ---------------------------------------------------------------------------
// Session lifecycle with schema-v2 fields
// ---------------------------------------------------------------------------
{
    const testUser = syncFirebaseUser({
        uid: `session-uid-${Date.now()}`,
        email: `session-${Date.now()}@example.com`,
        displayName: 'Session User',
        emailVerified: true,
        providerId: 'google.com',
    });

    const { token } = createSession(testUser.id, '127.0.0.1');
    check('creates session token', Boolean(token && token.length > 20));

    const verifiedUser = verifySession(token);
    check('verifySession returns public user', Boolean(verifiedUser && verifiedUser.id === testUser.id));
    check('verifySession preserves emailVerified', verifiedUser?.emailVerified === true);
    check('verifySession preserves provider', verifiedUser?.provider === 'google.com');

    revokeSession(token);
    check('verifySession returns null after revokeSession', verifySession(token) === null);
}

// ---------------------------------------------------------------------------
// requireVerifiedEmail Middleware
// ---------------------------------------------------------------------------
function mockRes() {
    const res = {
        statusCode: 0,
        body: null as unknown,
        status(code: number) { res.statusCode = code; return res; },
        json(payload: unknown) { res.body = payload; return res; },
    };
    return res;
}

{
    let nextCalled = false;
    requireVerifiedEmail({ user: { id: 'u1', emailVerified: true } } as never, mockRes() as never, () => { nextCalled = true; });
    check('requireVerifiedEmail allows verified user', nextCalled === true);

    let next2 = false;
    const res2 = mockRes();
    requireVerifiedEmail({ user: { id: 'u2', emailVerified: false } } as never, res2 as never, () => { next2 = true; });
    check('requireVerifiedEmail rejects unverified with 403', res2.statusCode === 403 && !next2);
    check('requireVerifiedEmail returns unverified code', (res2.body as { code?: string })?.code === 'auth/unverified-email');

    let next3 = false;
    const res3 = mockRes();
    requireVerifiedEmail({ user: { id: 'anon:1.2.3.4', email: null, emailVerified: false } } as never, res3 as never, () => { next3 = true; });
    check('requireVerifiedEmail rejects anonymous with 403', res3.statusCode === 403 && !next3);

    let next4 = false;
    const res4 = mockRes();
    requireVerifiedEmail({ user: null } as never, res4 as never, () => { next4 = true; });
    check('requireVerifiedEmail rejects unauthenticated with 401', res4.statusCode === 401 && !next4);
}

// ---------------------------------------------------------------------------
// HTTP integration — ephemeral port, shared temp DB
// ---------------------------------------------------------------------------
const { createApp } = (await import('../server/app.cjs')) as unknown as {
    createApp: () => import('express').Application;
};

async function listen(app: import('express').Application) {
    const server = await new Promise<import('node:http').Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 3001}`;
    return { server, base };
}

async function call(base: string, method: string, urlPath: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${urlPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json, headers: res.headers };
}

const A = await listen(createApp());

{
    const noToken = await call(A.base, 'POST', '/api/auth/sync', {});
    check('sync without idToken -> 400', noToken.status === 400);

    const invalid = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'garbage' });
    check('sync with invalid token -> 401', invalid.status === 401);
    check('invalid-token error is generic (no stack leaked)',
        typeof (invalid.json as { error?: string })?.error === 'string' && !('stack' in (invalid.json as object)));

    const expired = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-expired' });
    check('sync with expired token -> 401', expired.status === 401);

    const outage = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-outage' });
    check('provider outage -> 503 with generic message',
        outage.status === 503 && /not configured/i.test(String((outage.json as { error?: string }).error)));

    const noEmail = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-no-email' });
    check('token without email -> 400', noEmail.status === 400);

    const ok = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-verified' });
    const okUser = (ok.json as { user?: { id: string; email: string; emailVerified: boolean; provider: string } }).user;
    const sessionToken = (ok.json as { token?: string }).token;
    check('sync with valid token -> 200', ok.status === 200);
    check('sync returns normalized user', okUser?.email === 'verified.user@example.com' && okUser?.emailVerified === true);
    check('sync returns a session token', typeof sessionToken === 'string' && (sessionToken?.length ?? 0) > 20);
    check('sync sets an httpOnly session cookie',
        /azemax_session=/.test(ok.headers.get('set-cookie') || '') && /HttpOnly/i.test(ok.headers.get('set-cookie') || ''));

    // Idempotent: a second sync for the same identity returns the same user.
    const ok2 = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-verified' });
    check('repeated sync is idempotent', (ok2.json as { user?: { id: string } }).user?.id === okUser?.id);

    // Unverified identity is surfaced as unverified, never auto-verified.
    const unverified = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-unverified' });
    check('unverified token -> emailVerified false',
        (unverified.json as { user?: { emailVerified: boolean } }).user?.emailVerified === false);

    // Pre-hijack guard at the HTTP boundary: the conflict token carries an
    // unverified claim for an email that already belongs to another account.
    rawDb.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('http-victim', 'conflict.victim@example.com', 'scrypt$victim', 'Victim', 1, new Date().toISOString(), new Date().toISOString());
    const conflictRes = await call(A.base, 'POST', '/api/auth/sync', { idToken: 'id-token-conflict' });
    check('sync with unverified email for an existing account -> 409', conflictRes.status === 409);
    check('409 response carries an actionable code',
        (conflictRes.json as { code?: string })?.code === 'auth/email-already-in-use');
    check('409 response leaks no internal detail',
        !JSON.stringify(conflictRes.json).includes('scrypt') && !('stack' in (conflictRes.json as object)));

    const me = await call(A.base, 'GET', '/api/auth/me', undefined, sessionToken);
    check('/me with session -> 200', me.status === 200);
    check('/me returns the synced user', (me.json as { user?: { email: string } }).user?.email === 'verified.user@example.com');

    const meAnon = await call(A.base, 'GET', '/api/auth/me');
    check('/me without session -> 401', meAnon.status === 401);

    // Firebase ID token used directly as a Bearer credential (cross-site
    // fallback path through authenticateRequest). Real ID tokens are JWTs.
    const meFirebase = await call(A.base, 'GET', '/api/auth/me', undefined, 'jwt.verified.sig');
    check('/me accepts a raw Firebase ID token (middleware verify+sync)', meFirebase.status === 200);

    // Logout revokes the server session; the token must stop working.
    const out = await call(A.base, 'POST', '/api/auth/logout', undefined, sessionToken);
    check('logout -> 200', out.status === 200);
    const meAfter = await call(A.base, 'GET', '/api/auth/me', undefined, sessionToken);
    check('session revoked after logout -> 401', meAfter.status === 401);
}

// ---------------------------------------------------------------------------
// Rate limiting (fresh app => fresh limiter) on the auth surface
// ---------------------------------------------------------------------------
{
    const B = await listen(createApp());
    let saw429 = false;
    let allowed = 0;
    let retryAfter: string | null = null;
    for (let i = 0; i < 45 && !saw429; i++) {
        const r = await call(B.base, 'POST', '/api/auth/sync', { idToken: 'id-token-verified' });
        if (r.status === 429) { saw429 = true; retryAfter = r.headers.get('retry-after'); }
        else allowed++;
    }
    check('rate-limit: repeated auth attempts get 429', saw429 === true);
    check('rate-limit: 429 carries Retry-After', typeof retryAfter === 'string' && retryAfter.length > 0);
    check('rate-limit: requests allowed up to the configured maximum', allowed > 0 && allowed <= 30);
    await new Promise<void>((resolve) => B.server.close(() => resolve()));
}

await new Promise<void>((resolve) => A.server.close(() => resolve()));

// Cleanup: drop the seam, close the DB, remove the temp directory.
fb.__setVerifyIdTokenForTests(null);
try { (db as unknown as { closeDatabase: () => void }).closeDatabase(); } catch { /* ignore */ }
try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch { /* ignore */ }

finish('authBackend');
