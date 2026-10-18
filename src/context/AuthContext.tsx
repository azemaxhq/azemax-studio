import React, { createContext, useContext, useState, useEffect, useCallback, useRef, memo, type ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { API_BASE, ApiError } from '../utils/apiClient';
import { setCurrentUserId } from '../utils/userStorage';
import { resetAccountSyncStatus } from '../core/sync/syncStatus';
import { authHeaders, setIdToken, clearIdToken, ensureIdToken, authFailureMessage } from '../utils/authToken';
import {
    isFirebaseClientConfigured,
    getFirebaseAuth,
    subscribeToAuthState,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    resendVerificationEmail,
    reloadFirebaseUser,
    signOutFirebase,
    mapFirebaseError,
    checkRedirectAuth,
} from '../core/auth/firebase';

/**
 * Honest, actionable message shown when the deployment has no Firebase client
 * configuration. Fail closed: the auth forms still render (so input validation
 * stays testable), but every credential operation reports this instead of
 * pretending to succeed.
 */
export const FIREBASE_NOT_CONFIGURED_MESSAGE =
    'Firebase Authentication is not configured on this deployment. Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID, then redeploy.';

export interface AuthUser {
    id: string;
    email: string;
    displayName: string | null;
    photoUrl?: string | null;
    emailVerified: boolean;
    provider?: string;
    firebaseUid?: string | null;
    createdAt: string;
    lastLoginAt?: string;
}

export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'verification-required' | 'error';

/**
 * Outcome of a credential operation. `status` is the state the auth context
 * settled into, so callers can route the user correctly (e.g. an email/password
 * sign-in that lands in `verification-required` goes to the verification pane
 * instead of the workspace).
 */
export interface AuthResult {
    ok: boolean;
    status: AuthStatus;
}

interface AuthContextValue {
    user: AuthUser | null;
    firebaseUser: FirebaseUser | null;
    status: AuthStatus;
    loading: boolean;
    error: string | null;
    isFirebaseConfigured: boolean;
    login: (email: string, password: string) => Promise<AuthResult>;
    signup: (email: string, password: string, displayName?: string) => Promise<AuthResult>;
    loginWithGoogle: () => Promise<AuthResult>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    sendPasswordResetEmail: (email: string) => Promise<void>;
    resendVerification: () => Promise<void>;
    checkVerification: () => Promise<boolean>;
    clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provider-derived account state. Google identities are always treated as
 * verified (Google asserts the email); email/password accounts must confirm
 * their address before `authenticated`.
 */
function statusForFirebaseUser(fbUser: FirebaseUser): AuthStatus {
    const googleLinked = fbUser.providerData.some((p) => p.providerId === 'google.com');
    return fbUser.emailVerified || googleLinked ? 'authenticated' : 'verification-required';
}

/**
 * Local storage is namespaced by the stable Firebase UID, not the application
 * database row id. The backend may be unreachable during the first sign-in and
 * reconcile later; using the provider UID means the account keeps the same
 * local namespace across that transition instead of appearing to lose its
 * workspace, settings, and chats.
 */
function withStableStorageId(profile: AuthUser, fbUser: FirebaseUser | null): AuthUser {
    if (!fbUser) return profile;
    return { ...profile, id: fbUser.uid, firebaseUid: fbUser.uid };
}

/** Project a provider user into the app profile when the backend is unreachable. */
function fallbackUserFor(fbUser: FirebaseUser): AuthUser {
    return {
        id: fbUser.uid,
        email: fbUser.email || '',
        displayName: fbUser.displayName || null,
        photoUrl: fbUser.photoURL || null,
        emailVerified: fbUser.emailVerified,
        provider: fbUser.providerData[0]?.providerId || 'password',
        firebaseUid: fbUser.uid,
        createdAt: fbUser.metadata.creationTime || new Date().toISOString(),
    };
}

async function request<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError(authFailureMessage({ networkError: true }), 0);
    }

    const contentType = res.headers?.get?.('content-type') ?? null;
    const text = await res.text().catch(() => '');
    let data: Record<string, unknown> = {};
    try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
        throw new ApiError(
            authFailureMessage({ contentType, status: res.status, apiBase: API_BASE }),
            res.status,
        );
    }

    if (!res.ok) {
        const bodyError = typeof data?.error === 'string' ? data.error : null;
        throw new ApiError(
            authFailureMessage({ contentType, status: res.status, bodyError, apiBase: API_BASE }),
            res.status,
        );
    }
    return data as T;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = memo(({ children }) => {
    const hasFirebase = isFirebaseClientConfigured();

    const [user, setUser] = useState<AuthUser | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<AuthStatus>('initializing');
    const [error, setError] = useState<string | null>(null);
    // Guards against duplicate provider operations (double-click / double
    // submit) — a second call while one is in flight is a no-op.
    const authOpRef = useRef(false);

    const applySignedOut = useCallback(() => {
        setUser(null);
        setFirebaseUser(null);
        setStatus('unauthenticated');
        setCurrentUserId(null);
        clearIdToken();
        resetAccountSyncStatus();
    }, []);

    // Sync a verified Firebase identity with the Azemax backend (/api/auth/sync).
    // forceRefresh mints a fresh ID token (used at explicit login/signup/
    // verification events so the server sees current claims); the init
    // listener uses the cached token to avoid a round trip on every load.
    const syncWithBackend = useCallback(async (fbUser: FirebaseUser, forceRefresh = false): Promise<AuthUser | null> => {
        try {
            const idToken = await fbUser.getIdToken(forceRefresh);
            // Cache the provider token immediately so subsequent API calls are
            // authenticated even if the sync round trip is slow.
            setIdToken(idToken);
            const data = await request<{ user: AuthUser }>('/auth/sync', { idToken });
            return data.user ?? null;
        } catch (err) {
            console.warn('[Auth] Sync with backend failed:', err);
            return null;
        }
    }, []);

    // Refresh application profile from /api/auth/me (used by the retry panel).
    const refresh = useCallback(async () => {
        if (!hasFirebase) {
            applySignedOut();
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const token = await ensureIdToken(true);
            if (!token) {
                applySignedOut();
                return;
            }
            const res = await fetch(`${API_BASE}/auth/me`, {
                credentials: 'include',
                headers: { ...authHeaders() },
            });
            if (!res.ok) {
                applySignedOut();
                return;
            }
            const data = (await res.json().catch(() => ({}))) as { user?: AuthUser };
            const activeFbUser = getFirebaseAuth()?.currentUser ?? firebaseUser ?? null;
            if (!activeFbUser) {
                // The provider ended the session while this request was in
                // flight; never apply a stale profile.
                applySignedOut();
                return;
            }
            if (data.user) {
                // Prefer the SDK's current user if the listener state has not
                // settled yet; both resolve to the same stable UID.
                const profile = withStableStorageId(data.user, activeFbUser);
                setUser(profile);
                setCurrentUserId(profile.id);
                setStatus(data.user.emailVerified ? 'authenticated' : 'verification-required');
            } else {
                applySignedOut();
            }
        } catch {
            applySignedOut();
        } finally {
            setLoading(false);
        }
    }, [hasFirebase, firebaseUser, applySignedOut]);

    // Initialize the single Firebase identity listener.
    useEffect(() => {
        if (!hasFirebase) {
            // Fail closed: no Firebase configuration means no verified identity
            // can exist. The auth PANES still render (validation stays usable),
            // and credential operations report the missing configuration.
            applySignedOut();
            setLoading(false);
            return;
        }

        if (!getFirebaseAuth()) {
            // Configuration is present but the SDK could not initialize. Fail
            // closed and let the user retry rather than silently pretending to
            // be signed out or signed in.
            setError('Firebase Authentication failed to initialize. Check the Firebase client configuration and reload.');
            setStatus('error');
            setLoading(false);
            return;
        }

        // Resolve any pending redirect sign-in (popup-blocked fallback).
        void checkRedirectAuth().catch(() => {});

        const unsubscribe = subscribeToAuthState((fbUser, token) => {
            // Keep the in-memory credential in lockstep with the SDK: a token
            // refresh (or sign-out) is reflected here, never cached stale.
            setIdToken(token);
            setFirebaseUser(fbUser);

            if (!fbUser) {
                applySignedOut();
                setLoading(false);
                return;
            }

            void (async () => {
                const nextStatus = statusForFirebaseUser(fbUser);
                const synced = await syncWithBackend(fbUser);
                // A slow sync must never apply after the provider has signed
                // out or switched identity (otherwise a stale response could
                // resurrect the previous account's UI state).
                if (getFirebaseAuth()?.currentUser?.uid !== fbUser.uid) return;
                if (synced) {
                    const profile = withStableStorageId(synced, fbUser);
                    setUser(profile);
                    setCurrentUserId(profile.id);
                } else {
                    // Backend unreachable (e.g. cold start): the provider is
                    // still authoritative for the session, so surface the
                    // verified provider profile. Protected APIs remain guarded
                    // server-side and reject with 401 until a sync succeeds.
                    const fallback = fallbackUserFor(fbUser);
                    setUser(fallback);
                    setCurrentUserId(fallback.id);
                }
                setStatus(nextStatus);
                setLoading(false);
            })();
        });

        const onUnauthorized = () => {
            // The cached credential was rejected; drop it and return to the
            // gate. End the provider session too, so a reload cannot silently
            // restore a credential the server has already rejected.
            applySignedOut();
            void signOutFirebase().catch(() => {});
        };
        window.addEventListener('azemax:unauthorized', onUnauthorized);

        return () => {
            unsubscribe?.();
            window.removeEventListener('azemax:unauthorized', onUnauthorized);
        };
    }, [hasFirebase, syncWithBackend, applySignedOut]);

    const runCredentialOp = useCallback(async (
        op: () => Promise<{ ok: boolean; status: AuthStatus; fbUser?: FirebaseUser | null }>,
    ): Promise<AuthResult> => {
        if (authOpRef.current) return { ok: false, status: 'unauthenticated' };
        authOpRef.current = true;
        setError(null);
        setLoading(true);
        try {
            const result = await op();
            return { ok: result.ok, status: result.status };
        } finally {
            setLoading(false);
            authOpRef.current = false;
        }
    }, []);

    const login = useCallback((email: string, pass: string): Promise<AuthResult> => {
        if (!hasFirebase) {
            setError(FIREBASE_NOT_CONFIGURED_MESSAGE);
            return Promise.resolve({ ok: false, status: 'unauthenticated' });
        }
        return runCredentialOp(async () => {
            try {
                const cred = await signInWithEmail(email, pass);
                if (!cred.user) return { ok: false, status: 'unauthenticated' as AuthStatus };
                setFirebaseUser(cred.user);
                const nextStatus = statusForFirebaseUser(cred.user);
                const synced = await syncWithBackend(cred.user, true);
                if (synced) {
                    const profile = withStableStorageId(synced, cred.user);
                    setUser(profile);
                    setCurrentUserId(profile.id);
                } else {
                    const fallback = fallbackUserFor(cred.user);
                    setUser(fallback);
                    setCurrentUserId(fallback.id);
                }
                setStatus(nextStatus);
                return { ok: true, status: nextStatus };
            } catch (err: unknown) {
                setError(mapFirebaseError(err));
                return { ok: false, status: 'unauthenticated' as AuthStatus };
            }
        });
    }, [hasFirebase, runCredentialOp, syncWithBackend]);

    const signup = useCallback((email: string, pass: string, displayName?: string): Promise<AuthResult> => {
        if (!hasFirebase) {
            setError(FIREBASE_NOT_CONFIGURED_MESSAGE);
            return Promise.resolve({ ok: false, status: 'unauthenticated' });
        }
        return runCredentialOp(async () => {
            try {
                const outcome = await signUpWithEmail(email, pass, displayName);
                if (!outcome.user) return { ok: false, status: 'unauthenticated' as AuthStatus };
                setFirebaseUser(outcome.user);
                const nextStatus = statusForFirebaseUser(outcome.user);
                const synced = await syncWithBackend(outcome.user, true);
                if (synced) {
                    const profile = withStableStorageId(synced, outcome.user);
                    setUser(profile);
                    setCurrentUserId(profile.id);
                } else {
                    const fallback = fallbackUserFor(outcome.user);
                    setUser(fallback);
                    setCurrentUserId(fallback.id);
                }
                setStatus(nextStatus);
                if (!outcome.verificationSent) {
                    setError(
                        outcome.verificationError ||
                        'Account created, but the verification email could not be sent. Use "Resend verification email" to try again.',
                    );
                }
                return { ok: true, status: nextStatus };
            } catch (err: unknown) {
                setError(mapFirebaseError(err));
                return { ok: false, status: 'unauthenticated' as AuthStatus };
            }
        });
    }, [hasFirebase, runCredentialOp, syncWithBackend]);

    const loginWithGoogle = useCallback((): Promise<AuthResult> => {
        if (!hasFirebase) {
            setError(FIREBASE_NOT_CONFIGURED_MESSAGE);
            return Promise.resolve({ ok: false, status: 'unauthenticated' });
        }
        return runCredentialOp(async () => {
            try {
                const cred = await signInWithGoogle();
                if (!cred.user) return { ok: false, status: 'unauthenticated' as AuthStatus };
                setFirebaseUser(cred.user);
                const nextStatus = statusForFirebaseUser(cred.user);
                const synced = await syncWithBackend(cred.user, true);
                if (synced) {
                    const profile = withStableStorageId(synced, cred.user);
                    setUser(profile);
                    setCurrentUserId(profile.id);
                } else {
                    const fallback = fallbackUserFor(cred.user);
                    setUser(fallback);
                    setCurrentUserId(fallback.id);
                }
                setStatus(nextStatus);
                return { ok: true, status: nextStatus };
            } catch (err: unknown) {
                setError(mapFirebaseError(err));
                return { ok: false, status: 'unauthenticated' as AuthStatus };
            }
        });
    }, [hasFirebase, runCredentialOp, syncWithBackend]);

    const sendPasswordResetEmailAction = useCallback(async (email: string): Promise<void> => {
        setError(null);
        if (!hasFirebase) {
            throw new Error(FIREBASE_NOT_CONFIGURED_MESSAGE);
        }
        try {
            await sendPasswordReset(email);
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            // Never reveal whether an account exists.
            if (code === 'auth/user-not-found') return;
            if (code === 'auth/invalid-email') {
                throw new Error('Please enter a valid email address.');
            }
            // Transport / configuration / throttling failures ARE actionable —
            // the user should be able to retry rather than wait for a message
            // that will never arrive.
            throw new Error(mapFirebaseError(err));
        }
    }, [hasFirebase]);

    const resendVerificationAction = useCallback(async (): Promise<void> => {
        if (!firebaseUser) throw new Error('No user is currently pending verification.');
        setError(null);
        try {
            await resendVerificationEmail(firebaseUser);
        } catch (err: unknown) {
            setError(mapFirebaseError(err));
            throw err;
        }
    }, [firebaseUser]);

    const checkVerificationAction = useCallback(async (): Promise<boolean> => {
        if (!firebaseUser) return false;
        try {
            await reloadFirebaseUser(firebaseUser);
            if (getFirebaseAuth()?.currentUser?.uid !== firebaseUser.uid) return false;
            if (firebaseUser.emailVerified) {
                // Fresh token so the backend records the now-verified state.
                const synced = await syncWithBackend(firebaseUser, true);
                if (getFirebaseAuth()?.currentUser?.uid !== firebaseUser.uid) return false;
                if (synced) {
                    const profile = withStableStorageId(synced, firebaseUser);
                    setUser(profile);
                    setCurrentUserId(profile.id);
                } else {
                    // The provider is authoritative for verification even if
                    // the backend is cold; reflect it locally so the gate can
                    // open. Protected APIs still fail closed until sync works.
                    const fallback = fallbackUserFor(firebaseUser);
                    setUser(fallback);
                    setCurrentUserId(fallback.id);
                }
                setStatus('authenticated');
                return true;
            }
            return false;
        } catch (err) {
            console.warn('[Auth] Check verification failed:', err);
            return false;
        }
    }, [firebaseUser, syncWithBackend]);

    const logout = useCallback(async () => {
        setLoading(true);
        try {
            if (hasFirebase) {
                await signOutFirebase().catch(() => {});
            }
            // The backend holds no session; sign-out is a Firebase client
            // operation. The call is an acknowledgement only.
            await request('/auth/logout').catch(() => {});
        } finally {
            applySignedOut();
            setLoading(false);
        }
    }, [hasFirebase, applySignedOut]);

    const clearError = useCallback(() => setError(null), []);

    const value: AuthContextValue = {
        user,
        firebaseUser,
        status,
        loading,
        error,
        isFirebaseConfigured: hasFirebase,
        login,
        signup,
        loginWithGoogle,
        logout,
        refresh,
        sendPasswordResetEmail: sendPasswordResetEmailAction,
        resendVerification: resendVerificationAction,
        checkVerification: checkVerificationAction,
        clearError,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
});

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}

/**
 * Non-throwing variant for providers that may be rendered in isolation by
 * unit tests/tools (ProjectProvider, SettingsProvider). In the real app the
 * AuthProvider always wraps them, so this always returns the live context.
 */
export function useAuthOptional(): AuthContextValue | null {
    return useContext(AuthContext);
}
