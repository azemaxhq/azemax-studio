/**
 * Firebase Admin service — initializes the Firebase Admin SDK safely
 * and verifies Firebase ID tokens.
 *
 * Credentials can be supplied via environment variables:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (formatted with standard escaped newlines: \n)
 *
 * If credentials are not configured, the service runs in unconfigured mode:
 * server continues running normally, while auth/sync cleanly returns
 * configuration status instead of crashing.
 */
// firebase-admin v14 dropped the legacy namespaced API: the top-level export no
// longer carries `credential`, `auth`, etc. (it exposes the modular functions),
// so `admin.credential.cert(...)` / `admin.auth()` throw at runtime — which
// silently left the server "unconfigured" and made /api/auth/sync return 503
// for every request. Use the modular subpath imports, which work under CommonJS.
const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const logger = require('../../lib/logger.cjs');

let appInstance = null;
let isConfigured = false;

/**
 * Test seam — lets unit tests inject a deterministic token verifier without
 * contacting real Firebase. Only set from tests via __setVerifyIdTokenForTests;
 * production code paths never touch it, and it is reset to null afterwards.
 */
function __setVerifyIdTokenForTests(fn) {
    globalThis.__azemax_verifyIdTokenOverride = typeof fn === 'function' ? fn : null;
}

function initFirebaseAdmin() {
    if (appInstance) return appInstance;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId) {
        logger.info('Firebase Admin not initialized: FIREBASE_PROJECT_ID is not set.');
        return null;
    }

    if (Boolean(clientEmail) !== Boolean(rawPrivateKey)) {
        // A half-configured service account is a deployment mistake: warn
        // loudly (never print the values) instead of silently falling back.
        logger.error(
            'Firebase Admin: FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be set together. ' +
            'Falling back to application default credentials.',
        );
    }

    try {
        // Reuse an already-initialized default app (e.g. another module, a test
        // harness, or a hot reload) instead of throwing "app already exists".
        if (getApps().length > 0) {
            appInstance = getApp();
            isConfigured = true;
            logger.info('Firebase Admin reusing existing default app', { projectId });
            return appInstance;
        }

        if (clientEmail && rawPrivateKey) {
            const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
            appInstance = initializeApp({
                credential: cert({
                    projectId,
                    clientEmail,
                    privateKey,
                }),
                projectId,
            });
            isConfigured = true;
            logger.info('Firebase Admin initialized with service account credentials', { projectId });
        } else {
            // Fall back to application default credentials / project ID
            appInstance = initializeApp({
                projectId,
            });
            isConfigured = true;
            logger.info('Firebase Admin initialized with application default credentials', { projectId });
        }
        return appInstance;
    } catch (err) {
        logger.error('Failed to initialize Firebase Admin SDK', { error: err.message });
        appInstance = null;
        isConfigured = false;
        return null;
    }
}

// Initialize on module load
initFirebaseAdmin();

function isFirebaseConfigured() {
    if (globalThis.__azemax_verifyIdTokenOverride) return true;
    return isConfigured && Boolean(appInstance);
}

function getFirebaseAdmin() {
    if (!appInstance) {
        initFirebaseAdmin();
    }
    return appInstance;
}

/**
 * Verify an ID token sent from the client.
 * Returns the decoded token or throws a classified error.
 */
async function verifyIdToken(idToken, checkRevoked = false) {
    // Test seam first: unit tests inject a verifier so the HTTP layer can be
    // exercised without real Firebase credentials or network access.
    if (globalThis.__azemax_verifyIdTokenOverride) {
        return globalThis.__azemax_verifyIdTokenOverride(idToken, checkRevoked);
    }

    if (!isFirebaseConfigured()) {
        const err = new Error('Firebase Authentication is not configured on the server');
        err.status = 503;
        err.code = 'auth/not-configured';
        throw err;
    }

    if (!idToken || typeof idToken !== 'string') {
        const err = new Error('Missing or invalid ID token');
        err.status = 400;
        err.code = 'auth/invalid-argument';
        throw err;
    }

    try {
        const decodedToken = await getAuth(appInstance).verifyIdToken(idToken, checkRevoked);
        return decodedToken;
    } catch (error) {
        const err = new Error(error.message || 'Token verification failed');
        err.code = error.code || 'auth/invalid-token';
        if (error.code === 'auth/id-token-expired') {
            err.status = 401;
            err.message = 'Authentication token has expired. Please sign in again.';
        } else if (error.code === 'auth/id-token-revoked') {
            err.status = 401;
            err.message = 'Authentication token has been revoked. Please sign in again.';
        } else {
            err.status = 401;
        }
        throw err;
    }
}

/**
 * Fetch user record directly from Firebase Auth by UID.
 */
async function getUser(uid) {
    if (!isFirebaseConfigured()) return null;
    try {
        return await getAuth(appInstance).getUser(uid);
    } catch {
        return null;
    }
}

module.exports = {
    initFirebaseAdmin,
    isFirebaseConfigured,
    getFirebaseAdmin,
    verifyIdToken,
    getUser,
    __setVerifyIdTokenForTests,
};
