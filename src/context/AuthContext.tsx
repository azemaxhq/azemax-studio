import React, { createContext, useContext, useState, useEffect, useCallback, useRef, memo, type ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { API_BASE, ApiError } from '../utils/apiClient';
import { setCurrentUserId } from '../utils/userStorage';
import { authHeaders, setSessionToken, clearSessionToken, authFailureMessage, AUTH_DISABLED } from '../utils/sessionToken';
import { PUBLIC_BETA, ANON_USER_ID } from '../utils/betaAccess';
import {
    isFirebaseClientConfigured,
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
 * Fixed identity used when the login gate is disabled
 * (VITE_DISABLE_AUTH=true). Mirrors the server's ensureDevUser() row.
 */
const BYPASS_USER: AuthUser = {
    id: 'local-dev',
    email: 'local-dev@azemax.local',
    displayName: 'Local Dev',
    photoUrl: null,
    emailVerified: true,
    provider: 'local',
    createdAt: '1970-01-01T00:00:00.000Z',
};

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
    isAnonymous: boolean;
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

async function request<T>(path: string, body?: unknown, customHeaders?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
                ...(customHeaders || {}),
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

    const [user, setUser] = useState<AuthUser | null>(() => {
        if (AUTH_DISABLED) {
            setCurrentUserId(BYPASS_USER.id);
            return BYPASS_USER;
        }
        if (PUBLIC_BETA) setCurrentUserId(ANON_USER_ID);
        return null;
    });

    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
    const [loading, setLoading] = useState(() => !AUTH_DISABLED);
    const [status, setStatus] = useState<AuthStatus>(() => {
        if (AUTH_DISABLED) return 'authenticated';
        return 'initializing';
    });
    const [error, setError] = useState<string | null>(null);
    // Guards against duplicate provider operations (double-click / double
    // submit) — a second call while one is in flight is a no-op.
    const authOpRef = useRef(false);

    const applySignedOut = useCallback(() => {
        setUser(null);
        setFirebaseUser(null);
        setStatus('unauthenticated');
        setCurrentUserId(PUBLIC_BETA ? ANON_USER_ID : null);
    }, []);

    // Sync a Firebase identity with the Azemax backend (/api/auth/sync).
    // forceRefresh mints a fresh ID token (used at explicit login/signup/
    // verification events so the server sees current claims); the init
    // listener uses the cached token to avoid a round trip on every load.
    const syncWithBackend = useCallback(async (fbUser: FirebaseUser, forceRefresh = false): Promise<AuthUser | null> => {
        try {
            const idToken = await fbUser.getIdToken(forceRefresh);
            const data = await request<{ user: AuthUser; token?: string }>('/auth/sync', {
                idToken,
            });

            if (data.user) {
                if (data.token) {
                    try {
                        setSessionToken(data.token);
                    } catch {
                        /* ignore storage error */
                    }
                }
                setUser(data.user);
                setCurrentUserId(data.user.id);
                return data.user;
            }
            return null;
        } catch (err) {
            console.warn('[Auth] Sync with backend error:', err);
            return null;
        }
    }, []);

    // Refresh application profile from /api/auth/me
    const refresh = useCallback(async () => {
        if (AUTH_DISABLED) return;
        try {
            const res = await fetch(`${API_BASE}/auth/me`, {
                credentials: 'include',
                headers: { ...authHeaders() },
            });
            if (!res.ok) {
                applySignedOut();
                return;
            }
            const data = await res.json().catch(() => ({}));
            if (data.user) {
                setUser(data.user);
                setCurrentUserId(data.user.id);
                // Email verification is a provider concern. Only demand it when
                // an email provider is actually configured; the local password
                // fallback (and the DISABLE_AUTH dev identity) have no way to
                // verify, so treating them as unverified would strand the user
                // on a verification pane with no possible action.
                const needsVerification =
                    hasFirebase &&
                    !data.user.emailVerified &&
                    data.user.provider !== 'google.com';
                setStatus(needsVerification ? 'verification-required' : 'authenticated');
            } else {
                applySignedOut();
            }
        } catch {
            applySignedOut();
        } finally {
            setLoading(false);
        }
    }, [applySignedOut, hasFirebase]);

    // Initialize Firebase Auth listener and check redirect results
    useEffect(() => {
        if (AUTH_DISABLED) {
            setCurrentUserId(BYPASS_USER.id);
            setStatus('authenticated');
            setLoading(false);
            return;
        }

        let unsubscribe: (() => void) | undefined;

        if (hasFirebase) {
            // Check for redirect sign-in completion (mobile/blocked popups)
            void checkRedirectAuth().catch(() => {});

            unsubscribe = subscribeToAuthState(async (fbUser) => {
                setFirebaseUser(fbUser);
                if (fbUser) {
                    const synced = await syncWithBackend(fbUser);
                    if (synced) {
                        setStatus(statusForFirebaseUser(fbUser));
                    } else {
                        // Fallback user from Firebase credentials if backend sync
                        // fails (e.g. backend cold-start). The server still
                        // verifies the Firebase ID token on API calls and syncs
                        // the user on first successful request.
                        const fallbackUser: AuthUser = {
                            id: fbUser.uid,
                            email: fbUser.email || '',
                            displayName: fbUser.displayName || null,
                            photoUrl: fbUser.photoURL || null,
                            emailVerified: fbUser.emailVerified,
                            provider: fbUser.providerData[0]?.providerId || 'password',
                            firebaseUid: fbUser.uid,
                            createdAt: fbUser.metadata.creationTime || new Date().toISOString(),
                        };
                        setUser(fallbackUser);
                        setCurrentUserId(fallbackUser.id);
                        setStatus(statusForFirebaseUser(fbUser));
                    }
                    setLoading(false);
                } else {
                    // Firebase user signed out or null: check server session as fallback
                    void refresh();
                }
            });
        } else {
            // Local backend session check
            void refresh();
        }

        const onUnauthorized = () => {
            applySignedOut();
            try {
                clearSessionToken();
            } catch {
                /* ignore */
            }
        };
        window.addEventListener('azemax:unauthorized', onUnauthorized);

        return () => {
            unsubscribe?.();
            window.removeEventListener('azemax:unauthorized', onUnauthorized);
        };
    }, [hasFirebase, syncWithBackend, refresh, applySignedOut]);

    const login = useCallback(async (email: string, pass: string): Promise<AuthResult> => {
        if (AUTH_DISABLED) return { ok: true, status: 'authenticated' };
        if (authOpRef.current) return { ok: false, status: 'error' };
        authOpRef.current = true;
        setError(null);
        setLoading(true);

        if (hasFirebase) {
            try {
                const cred = await signInWithEmail(email, pass);
                if (cred.user) {
                    setFirebaseUser(cred.user);
                    const nextStatus = statusForFirebaseUser(cred.user);
                    const synced = await syncWithBackend(cred.user, true);
                    setStatus(nextStatus);
                    if (synced) setCurrentUserId(synced.id);
                    return { ok: true, status: nextStatus };
                }
                return { ok: false, status: 'error' };
            } catch (err: unknown) {
                setError(mapFirebaseError(err));
                setStatus('error');
                return { ok: false, status: 'error' };
            } finally {
                setLoading(false);
                authOpRef.current = false;
            }
        }

        // Fallback to local API
        try {
            const data = await request<{ user: AuthUser; token?: string }>('/auth/login', { email, password: pass });
            if (!data.user) {
                throw new ApiError(authFailureMessage({ status: 200, bodyError: null, apiBase: API_BASE }), 200);
            }
            try {
                setSessionToken(data.token ?? null);
            } catch {
                /* ignore */
            }
            setUser(data.user);
            setCurrentUserId(data.user.id);
            setStatus('authenticated');
            return { ok: true, status: 'authenticated' };
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Login failed');
            setStatus('error');
            return { ok: false, status: 'error' };
        } finally {
            setLoading(false);
            authOpRef.current = false;
        }
    }, [hasFirebase, syncWithBackend]);

    const signup = useCallback(async (email: string, pass: string, displayName?: string): Promise<AuthResult> => {
        if (AUTH_DISABLED) return { ok: true, status: 'authenticated' };
        if (authOpRef.current) return { ok: false, status: 'error' };
        authOpRef.current = true;
        setError(null);
        setLoading(true);

        if (hasFirebase) {
            try {
                const outcome = await signUpWithEmail(email, pass, displayName);
                if (outcome.user) {
                    setFirebaseUser(outcome.user);
                    // Server-side registration via the existing contract. A new
                    // account is NEVER treated as verified until the provider says so.
                    const synced = await syncWithBackend(outcome.user, true);
                    setStatus('verification-required');
                    if (synced) setCurrentUserId(synced.id);
                    if (!outcome.verificationSent) {
                        setError(
                            outcome.verificationError ||
                            'Account created, but the verification email could not be sent. Use “Resend verification email” to try again.',
                        );
                    }
                    return { ok: true, status: 'verification-required' };
                }
                return { ok: false, status: 'error' };
            } catch (err: unknown) {
                setError(mapFirebaseError(err));
                setStatus('error');
                return { ok: false, status: 'error' };
            } finally {
                setLoading(false);
                authOpRef.current = false;
            }
        }

        // Fallback to local API
        try {
            const data = await request<{ user: AuthUser; token?: string }>('/auth/signup', {
                email,
                password: pass,
                displayName,
            });
            if (!data.user) {
                throw new ApiError(authFailureMessage({ status: 200, bodyError: null, apiBase: API_BASE }), 200);
            }
            try {
                setSessionToken(data.token ?? null);
            } catch {
                /* ignore */
            }
            setUser(data.user);
            setCurrentUserId(data.user.id);
            setStatus('authenticated');
            return { ok: true, status: 'authenticated' };
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Sign up failed');
            setStatus('error');
            return { ok: false, status: 'error' };
        } finally {
            setLoading(false);
            authOpRef.current = false;
        }
    }, [hasFirebase, syncWithBackend]);

    const loginWithGoogle = useCallback(async (): Promise<AuthResult> => {
        if (AUTH_DISABLED) return { ok: true, status: 'authenticated' };
        if (authOpRef.current) return { ok: false, status: 'error' };
        authOpRef.current = true;
        setError(null);
        setLoading(true);

        if (!hasFirebase) {
            setError('Google sign-in requires Firebase configuration (VITE_FIREBASE_API_KEY).');
            setLoading(false);
            authOpRef.current = false;
            return { ok: false, status: 'error' };
        }

        try {
            const cred = await signInWithGoogle();
            if (cred.user) {
                setFirebaseUser(cred.user);
                const nextStatus = statusForFirebaseUser(cred.user);
                const synced = await syncWithBackend(cred.user, true);
                setStatus(nextStatus);
                if (synced) setCurrentUserId(synced.id);
                return { ok: true, status: nextStatus };
            }
            return { ok: false, status: 'error' };
        } catch (err: unknown) {
            setError(mapFirebaseError(err));
            setStatus('error');
            return { ok: false, status: 'error' };
        } finally {
            setLoading(false);
            authOpRef.current = false;
        }
    }, [hasFirebase, syncWithBackend]);

    const sendPasswordResetEmailAction = useCallback(async (email: string): Promise<void> => {
        setError(null);
        if (!hasFirebase) {
            // No email provider is configured, so no reset message can actually
            // be delivered. Surface that honestly instead of faking success.
            throw new Error(
                'Password reset is unavailable because email sign-in is not configured on this deployment.',
            );
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
        if (!firebaseUser) throw new Error('No user currently pending verification');
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
            if (firebaseUser.emailVerified) {
                // Fresh token so the backend records the now-verified state.
                await syncWithBackend(firebaseUser, true);
                setStatus('authenticated');
                return true;
            }
            return false;
        } catch (err) {
            console.warn('[Auth] Check verification error:', err);
            return false;
        }
    }, [firebaseUser, syncWithBackend]);

    const logout = useCallback(async () => {
        if (AUTH_DISABLED) return;
        setLoading(true);
        try {
            if (hasFirebase) {
                await signOutFirebase().catch(() => {});
            }
            await request('/auth/logout').catch(() => {});
        } finally {
            try {
                clearSessionToken();
            } catch {
                /* ignore */
            }
            applySignedOut();
            setLoading(false);
        }
    }, [hasFirebase, applySignedOut]);

    const clearError = useCallback(() => setError(null), []);

    const isAnonymous = PUBLIC_BETA && !AUTH_DISABLED && user === null;

    const value: AuthContextValue = {
        user,
        firebaseUser,
        status,
        loading,
        error,
        isAnonymous,
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
