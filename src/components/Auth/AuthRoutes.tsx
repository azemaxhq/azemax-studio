import { useCallback, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import {
    DEFAULT_AUTH_REDIRECT,
    isAuthRoutePath,
    navigate,
    readRedirectParam,
} from '../../utils/appRouter';

/** Strip a trailing slash so `/login/` matches `/login`. */
function normalizeRoute(path: string): string {
    const clean = (path || '').split(/[?#]/)[0];
    return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

/**
 * Authentication route resolver.
 *
 * Rendered by App for the auth surface (/login, /signup, /forgot-password,
 * /verify-email, /auth/callback) inside the shared AuthProvider, so auth state
 * is preserved while moving between the panes. Responsibilities:
 *  - keep the intended post-login destination across route hops
 *  - send already-authenticated users away (no login page for signed-in users)
 *  - route signed-in-but-unverified users to the verification pane
 *  - resolve OAuth redirect results (popup-blocked fallback) on the callback
 */
export function AuthRoutes({ path }: { path: string }) {
    const { status, user } = useAuth();
    const redirect = readRedirectParam(typeof window !== 'undefined' ? window.location.search : '');
    const route = normalizeRoute(path);
    const authed = status === 'authenticated' && Boolean(user);

    // SPA navigation that preserves the intended destination across auth hops.
    const go = useCallback((target: string) => {
        const [base] = String(target).split('#');
        const hasQuery = base.includes('?');
        const pathOnly = base.split('?')[0];
        if (
            isAuthRoutePath(pathOnly) &&
            redirect !== DEFAULT_AUTH_REDIRECT &&
            !/[?&]redirect=/.test(base)
        ) {
            navigate(`${base}${hasQuery ? '&' : '?'}redirect=${encodeURIComponent(redirect)}`);
            return;
        }
        navigate(target);
    }, [redirect]);

    // Authenticated users must never sit on an auth pane.
    useEffect(() => {
        if (authed) navigate(redirect);
    }, [authed, redirect]);

    if (authed) return <AuthSplash label="Taking you to your workspace…" />;

    // Don't flash a form before we know whether a session exists.
    if (status === 'initializing') return <AuthSplash label="Restoring your session…" />;

    if (route === '/auth/callback') {
        return <AuthCallback redirect={redirect} />;
    }

    // Signed in but email not verified: the login/signup panes are dead ends,
    // so send the user to the verification pane instead (no redirect loop).
    if (status === 'verification-required' && (route === '/login' || route === '/signup')) {
        return <VerifyEmailPage onNavigate={go} redirectUrl={redirect} />;
    }

    switch (route) {
        case '/signup':
            return <SignupPage onNavigate={go} redirectUrl={redirect} />;
        case '/forgot-password':
            return <ForgotPasswordPage onNavigate={go} />;
        case '/verify-email':
            return <VerifyEmailPage onNavigate={go} redirectUrl={redirect} />;
        case '/login':
        default:
            return <LoginPage onNavigate={go} redirectUrl={redirect} />;
    }
}

/** Spinner shown while auth state settles / redirects are applied. */
function AuthSplash({ label }: { label: string }) {
    return (
        <div
            className="az-auth flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--az-bg)] text-[var(--az-text)]"
            role="status"
            aria-live="polite"
        >
            <AzemaxLogo size={34} />
            <div className="flex items-center gap-2.5">
                <span className="az-spinner" aria-hidden="true" />
                <p className="text-[13px] text-[var(--az-text-muted)]">{label}</p>
            </div>
        </div>
    );
}

/**
 * OAuth redirect fallback landing. Firebase resolves the redirect result during
 * AuthProvider init; this pane simply waits for that to settle, then forwards
 * the user (or returns them to login on failure). Bounded — never hangs.
 */
function AuthCallback({ redirect }: { redirect: string }) {
    const { status, user } = useAuth();

    useEffect(() => {
        if (status === 'authenticated' && user) {
            navigate(redirect);
            return;
        }
        if (status === 'unauthenticated' || status === 'error') {
            navigate('/login');
            return;
        }
        // Give the provider SDK a bounded window to resolve the redirect.
        const timer = window.setTimeout(() => navigate('/login'), 15000);
        return () => window.clearTimeout(timer);
    }, [status, user, redirect]);

    return <AuthSplash label="Completing sign-in…" />;
}
