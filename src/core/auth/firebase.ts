import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendEmailVerification,
    sendPasswordResetEmail,
    updateProfile,
    signOut,
    onIdTokenChanged,
    GoogleAuthProvider,
    type ActionCodeSettings,
    type Auth,
    type User,
    type UserCredential,
} from 'firebase/auth';

export interface FirebaseClientConfig {
    apiKey?: string;
    authDomain?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
}

function readClientConfig(): FirebaseClientConfig {
    try {
        // Reference `import.meta.env` literally so Vite injects it (contextual
        // note: the optional-chained form on `import.meta` itself is fine, but
        // an indirect reference would break env injection, leaving Firebase
        // unconfigured in every build).
        const env = import.meta.env as Record<string, string | undefined> | undefined;
        return {
            apiKey: env?.VITE_FIREBASE_API_KEY,
            authDomain: env?.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: env?.VITE_FIREBASE_PROJECT_ID,
            storageBucket: env?.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env?.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: env?.VITE_FIREBASE_APP_ID,
        };
    } catch {
        return {};
    }
}

export const firebaseConfig = readClientConfig();

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

export function isFirebaseClientConfigured(): boolean {
    return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

export function getFirebaseApp(): FirebaseApp | null {
    if (!isFirebaseClientConfigured()) return null;
    if (appInstance) return appInstance;

    const existingApps = getApps();
    if (existingApps.length > 0) {
        appInstance = getApp();
        return appInstance;
    }

    try {
        appInstance = initializeApp({
            apiKey: firebaseConfig.apiKey,
            authDomain: firebaseConfig.authDomain || (firebaseConfig.projectId ? `${firebaseConfig.projectId}.firebaseapp.com` : undefined),
            projectId: firebaseConfig.projectId,
            storageBucket: firebaseConfig.storageBucket,
            messagingSenderId: firebaseConfig.messagingSenderId,
            appId: firebaseConfig.appId,
        });
        return appInstance;
    } catch (err) {
        console.warn('[Firebase] Initialization error:', err);
        return null;
    }
}

export function getFirebaseAuth(): Auth | null {
    if (authInstance) return authInstance;
    const app = getFirebaseApp();
    if (!app) return null;
    try {
        authInstance = getAuth(app);
        return authInstance;
    } catch (err) {
        console.warn('[Firebase Auth] Failed to get Auth instance:', err);
        return null;
    }
}

/**
 * Where Firebase returns the user after an email action (verification or
 * password reset). Pointing at the app's own origin keeps the action on the
 * Azemax domain instead of the default Firebase-hosted page. The target must be
 * listed under Firebase console → Authentication → Settings → Authorized
 * domains, otherwise the provider rejects the send (surfaced to the UI).
 */
function getActionCodeSettings(): ActionCodeSettings | undefined {
    try {
        if (typeof window === 'undefined' || !window.location?.origin) return undefined;
        return { url: `${window.location.origin}/login`, handleCodeInApp: false };
    } catch {
        return undefined;
    }
}

/**
 * Configure Google Auth Provider with recommended scopes and prompt
 */
function createGoogleProvider(): GoogleAuthProvider {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    provider.setCustomParameters({
        prompt: 'select_account',
    });
    return provider;
}

export async function signInWithGoogle(): Promise<UserCredential> {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID.');
    }

    const provider = createGoogleProvider();
    try {
        return await signInWithPopup(auth, provider);
    } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (error.code === 'auth/popup-blocked') {
            // Fall back to redirect if popup was blocked
            await signInWithRedirect(auth, provider);
            // Will navigate away, return dummy promise that will not resolve before reload
            return new Promise(() => { });
        }
        throw err;
    }
}

export async function checkRedirectAuth(): Promise<UserCredential | null> {
    const auth = getFirebaseAuth();
    if (!auth) return null;
    try {
        return await getRedirectResult(auth);
    } catch {
        return null;
    }
}

export async function signInWithEmail(email: string, pass: string): Promise<UserCredential> {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error('Firebase Authentication is not configured.');
    }
    return await signInWithEmailAndPassword(auth, email.trim(), pass);
}

export interface SignUpOutcome {
    user: User | null;
    /** False when the account was created but the verification email did not send. */
    verificationSent: boolean;
    /** Friendly reason the verification email failed, when it did. */
    verificationError?: string;
}

export async function signUpWithEmail(email: string, pass: string, displayName?: string): Promise<SignUpOutcome> {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error('Firebase Authentication is not configured.');
    }
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    let verificationSent = false;
    let verificationError: string | undefined;

    if (cred.user) {
        if (displayName?.trim()) {
            try {
                await updateProfile(cred.user, { displayName: displayName.trim() });
            } catch {
                // Non-fatal, profile can be updated later
            }
        }
        try {
            await sendEmailVerification(cred.user, getActionCodeSettings());
            verificationSent = true;
        } catch (err) {
            // The account exists, but the user must be told the message did not
            // go out — never silently pretend a verification email was sent.
            verificationSent = false;
            verificationError = mapFirebaseError(err);
        }
    }
    return { user: cred.user, verificationSent, verificationError };
}

export async function sendPasswordReset(email: string): Promise<void> {
    const auth = getFirebaseAuth();
    if (!auth) {
        throw new Error('Firebase Authentication is not configured.');
    }
    await sendPasswordResetEmail(auth, email.trim(), getActionCodeSettings());
}

export async function resendVerificationEmail(user: User): Promise<void> {
    await sendEmailVerification(user, getActionCodeSettings());
}

export async function reloadFirebaseUser(user: User): Promise<void> {
    await user.reload();
}

export async function signOutFirebase(): Promise<void> {
    const auth = getFirebaseAuth();
    if (auth) {
        await signOut(auth);
    }
}

/**
 * Read the current user's Firebase ID token (the credential presented to the
 * Azemax backend as `Authorization: Bearer`). Returns null when no user is
 * signed in or Firebase is unavailable — never throws, so callers fail closed.
 *
 * `forceRefresh` mints a brand-new token (used at explicit sign-in/verification
 * events so the server observes current claims); otherwise the SDK's cached,
 * auto-refreshed token is used.
 */
export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
    const auth = getFirebaseAuth();
    const current = auth?.currentUser ?? null;
    if (!current) return null;
    try {
        return await current.getIdToken(forceRefresh);
    } catch {
        return null;
    }
}

/**
 * Subscribe to identity AND token changes (`onIdTokenChanged` fires on
 * sign-in, sign-out, and every ID-token refresh). The callback receives the
 * current token alongside the user so the app credential cache always mirrors
 * the SDK — a refreshed token can never be missed between requests.
 */
export function subscribeToAuthState(
    callback: (user: User | null, token: string | null) => void,
): () => void {
    const auth = getFirebaseAuth();
    if (!auth) {
        callback(null, null);
        return () => { };
    }
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, (user) => {
        void (async () => {
            let token: string | null = null;
            if (user) {
                try {
                    token = await user.getIdToken();
                } catch {
                    token = null;
                }
            }
            if (active) callback(user, token);
        })();
    });
    return () => {
        active = false;
        unsubscribe();
    };
}

/**
 * Maps Firebase error codes to polished, user-friendly messages.
 */
export function mapFirebaseError(err: unknown): string {
    if (!err || typeof err !== 'object') return 'An unexpected authentication error occurred.';
    const error = err as { code?: string; message?: string };

    switch (error.code) {
        case 'auth/user-not-found':
            return 'No account exists with this email address. Please sign up.';
        case 'auth/wrong-password':
            return 'Incorrect password. Please try again or reset your password.';
        case 'auth/invalid-credential':
            return 'Invalid email or password. Please verify your credentials.';
        case 'auth/email-already-in-use':
            return 'An account with this email address already exists. Please sign in.';
        case 'auth/weak-password':
            return 'Password is too weak. Use at least 10 characters — a longer passphrase is stronger.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/user-disabled':
            return 'This account has been disabled. Please contact support.';
        case 'auth/too-many-requests':
            return 'Access to this account has been temporarily disabled due to many failed attempts. Please reset your password or try again later.';
        case 'auth/operation-not-allowed':
            return 'This sign-in method is not enabled. Please contact the administrator.';
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'Google sign-in was cancelled.';
        case 'auth/popup-blocked':
            return 'The sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
        case 'auth/account-exists-with-different-credential':
            return 'An account already exists with this email using a different sign-in method. Sign in that way first, then link Google from your account settings.';
        case 'auth/credential-already-in-use':
            return 'This Google account is already linked to another Azemax account.';
        case 'auth/unauthorized-continue-uri':
            return 'This domain is not authorized for sign-in emails. Add it to Firebase Authentication → Settings → Authorized domains.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your internet connection and try again.';
        case 'auth/requires-recent-login':
            return 'This operation is sensitive and requires recent authentication. Please sign in again.';
        default:
            return error.message || 'Authentication failed. Please try again.';
    }
}
