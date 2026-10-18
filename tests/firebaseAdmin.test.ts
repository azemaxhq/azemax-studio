/**
 * Regression test for the Firebase Admin *initialization wiring*.
 *
 * Background: firebase-admin v14 removed the legacy namespaced API
 * (`admin.credential`, `admin.auth`, ...). An earlier version of
 * server/services/auth/firebaseAdmin.cjs still called
 * `admin.credential.cert(...)` / `admin.auth()`, so initialization threw on
 * every boot and the module reported itself "unconfigured". The visible effect
 * was that POST /api/auth/sync returned 503 `auth/not-configured` for every
 * request — even with perfectly valid production credentials.
 *
 * The other auth suites never caught it because they inject a deterministic
 * verifier through the test seam, which short-circuits *before* the Admin SDK
 * is touched. This test deliberately avoids the seam so the real
 * `initializeApp` / `cert` code path runs.
 *
 * It is fully offline and side-effect free:
 *  - the service-account key is generated in-process (throwaway RSA key);
 *  - `cert()`/`initializeApp()` only parse the key locally (no network);
 *  - the malformed-token assertion fails during local JWT decoding, before any
 *    public-key fetch.
 */
import { generateKeyPairSync } from 'node:crypto';
import { check, finish } from './_harness';

const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const TEST_PROJECT_ID = 'azemax-admin-init-test';

// These must be present before the module is imported: it initializes on load.
process.env.FIREBASE_PROJECT_ID = TEST_PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL = `test-admin@${TEST_PROJECT_ID}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = privateKey;

const fb = await import('../server/services/auth/firebaseAdmin.cjs');

// Make sure the verifier seam is clear — otherwise isFirebaseConfigured()
// returns true for the wrong reason and this regression test proves nothing.
fb.__setVerifyIdTokenForTests(null);
check(
    'firebaseAdmin: verifier seam is clear (test would otherwise be vacuous)',
    (globalThis as { __azemax_verifyIdTokenOverride?: unknown }).__azemax_verifyIdTokenOverride == null,
);

check(
    'firebaseAdmin: real service-account init marks the module configured',
    fb.isFirebaseConfigured() === true,
);

const app = fb.getFirebaseAdmin();
check('firebaseAdmin: getFirebaseAdmin() returns an app instance', app !== null && typeof app === 'object');
check(
    'firebaseAdmin: app carries the configured project id',
    app?.options?.projectId === TEST_PROJECT_ID,
);

// A malformed token must surface as an authentication failure (401) — never as
// "not-configured" (503). This is the exact symptom of the original bug.
let code = '';
let status = 0;
try {
    await fb.verifyIdToken('not-a-jwt');
} catch (err) {
    const e = err as { code?: string; status?: number };
    code = e.code ?? '';
    status = e.status ?? 0;
}
check(
    'firebaseAdmin: malformed token -> auth failure, not auth/not-configured',
    code !== 'auth/not-configured' && status === 401,
);

// Escaped newlines are how env files and Render/Heroku-style config deliver
// the key; the module normalizes them (\\n -> \n) before handing the PEM to
// cert(). Prove the normalized form is actually accepted by cert().
const { cert } = await import('firebase-admin/app');
const escapedKey = privateKey.replace(/\n/g, '\\n');
let escapedKeyAccepted = false;
try {
    cert({
        projectId: TEST_PROJECT_ID,
        clientEmail: `test-admin@${TEST_PROJECT_ID}.iam.gserviceaccount.com`,
        privateKey: escapedKey.replace(/\\n/g, '\n'),
    });
    escapedKeyAccepted = true;
} catch {
    escapedKeyAccepted = false;
}
check('firebaseAdmin: escaped-newline key is accepted after normalization', escapedKeyAccepted);

finish('firebaseAdmin');
