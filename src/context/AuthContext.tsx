import React, { createContext, useContext, useState, useEffect, useCallback, memo, type ReactNode } from 'react';
import { API_BASE, ApiError } from '../utils/apiClient';
import { setCurrentUserId } from '../utils/userStorage';
import { authHeaders, setSessionToken, clearSessionToken, authFailureMessage } from '../utils/sessionToken';

export interface AuthUser {
    id: string;
    email: string;
    displayName: string | null;
    createdAt: string;
}

interface AuthContextValue {
    user: AuthUser | null;
    loading: boolean;
    error: string | null;
    login: (email: string, password: string) => Promise<boolean>;
    signup: (email: string, password: string, displayName?: string) => Promise<boolean>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function request<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        // DNS down, backend asleep, or CORS preflight rejected — the browser
        // surfaces all three as a TypeError with no status. Tell the user
        // what to check instead of a bare "Failed to fetch".
        throw new ApiError(authFailureMessage({ networkError: true }), 0);
    }
    const contentType = res.headers?.get?.('content-type') ?? null;
    const text = await res.text().catch(() => '');
    let data: Record<string, unknown> = {};
    try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
        // Non-JSON body (e.g. the SPA index.html when VITE_API_URL points at
        // the static host instead of the API) — misconfiguration, not a
        // credential problem. Say so explicitly.
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
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/auth/me`, {
                credentials: 'include',
                headers: { ...authHeaders() },
            });
            if (!res.ok) {
                setUser(null);
                setCurrentUserId(null);
                return;
            }
            const data = await res.json().catch(() => ({}));
            setUser(data.user ?? null);
            setCurrentUserId(data.user ? data.user.id : null);
        } catch {
            setUser(null);
            setCurrentUserId(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
        // Mid-session expiry (401 from any apiFetch) drops back to login.
        const onUnauthorized = () => {
            setUser(null);
            setCurrentUserId(null);
            // Drop the fallback token too: it is dead (rotated DB, expiry,
            // explicit revoke) and would only re-trigger 401s.
            try {
                clearSessionToken();
            } catch {
                /* storage unavailable */
            }
        };
        window.addEventListener('azemax:unauthorized', onUnauthorized);
        return () => window.removeEventListener('azemax:unauthorized', onUnauthorized);
    }, [refresh]);

    const login = useCallback(async (email: string, password: string) => {
        setError(null);
        try {
            const data = await request<{ user: AuthUser; token?: string }>('/auth/login', { email, password });
            if (!data.user) {
                // Defensive: a 200 without a user (e.g. proxied HTML that
                // slipped through) must not set broken state.
                throw new ApiError(
                    authFailureMessage({ status: 200, bodyError: null, apiBase: API_BASE }),
                    200,
                );
            }
            // Persist the fallback token (cookie remains primary). Without
            // this, cross-site third-party-cookie blocking silently drops the
            // session right after a successful login.
            try {
                setSessionToken(data.token ?? null);
            } catch {
                /* storage unavailable — cookie path still works same-site */
            }
            setUser(data.user);
            setCurrentUserId(data.user.id);
            return true;
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Login failed');
            return false;
        }
    }, []);

    const signup = useCallback(async (email: string, password: string, displayName?: string) => {
        setError(null);
        try {
            const data = await request<{ user: AuthUser; token?: string }>('/auth/signup', { email, password, displayName });
            if (!data.user) {
                throw new ApiError(
                    authFailureMessage({ status: 200, bodyError: null, apiBase: API_BASE }),
                    200,
                );
            }
            try {
                setSessionToken(data.token ?? null);
            } catch {
                /* storage unavailable — cookie path still works same-site */
            }
            setUser(data.user);
            setCurrentUserId(data.user.id);
            return true;
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Sign up failed');
            return false;
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            // Bearer header revokes the fallback session server-side even
            // when the cookie was never stored (third-party cookies blocked).
            await request('/auth/logout');
        } catch {
            /* session already dead — still clear local state */
        }
        try {
            clearSessionToken();
        } catch {
            /* storage unavailable */
        }
        setUser(null);
        setCurrentUserId(null);
    }, []);

    const clearError = useCallback(() => setError(null), []);

    const value: AuthContextValue = { user, loading, error, login, signup, logout, refresh, clearError };
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
});

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
