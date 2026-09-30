import React, { createContext, useContext, useState, useEffect, useCallback, memo, type ReactNode } from 'react';
import { API_BASE, ApiError } from '../utils/apiClient';
import { setCurrentUserId } from '../utils/userStorage';

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
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new ApiError(typeof data?.error === 'string' ? data.error : res.statusText, res.status);
    }
    return data as T;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = memo(({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
            if (!res.ok) {
                setUser(null);
                setCurrentUserId(null);
                return;
            }
            const data = await res.json();
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
        };
        window.addEventListener('azemax:unauthorized', onUnauthorized);
        return () => window.removeEventListener('azemax:unauthorized', onUnauthorized);
    }, [refresh]);

    const login = useCallback(async (email: string, password: string) => {
        setError(null);
        try {
            const data = await request<{ user: AuthUser }>('/auth/login', { email, password });
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
            const data = await request<{ user: AuthUser }>('/auth/signup', { email, password, displayName });
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
            await request('/auth/logout');
        } catch {
            /* session already dead — still clear local state */
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
