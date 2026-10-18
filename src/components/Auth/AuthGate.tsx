import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { AuthButton } from './primitives';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { navigate } from '../../utils/appRouter';

/**
 * Authentication gate for the /app workspace.
 *
 * Firebase Authentication is the sole identity provider and there is no guest
 * or anonymous mode: the workspace renders ONLY for a signed-in user whose
 * email the provider has verified. Every other state is handled explicitly —
 *
 *  - initializing  → branded spinner (never a flash of the login form)
 *  - error         → fail-closed panel with a retry action
 *  - verification  → the verification pane (resend / re-check / sign out)
 *  - unauthenticated → the sign-in pane
 *  - authenticated → the workspace
 *
 * This is a UX gate only. The real boundary is the backend, which verifies the
 * Firebase ID token on every request and rejects unauthenticated/unverified
 * callers (401/403) regardless of what the client renders.
 */
export function AuthGate({ children }: { children: ReactNode }) {
    const { user, loading, status, error, refresh } = useAuth();

    if (loading || status === 'initializing') return <GateSpinner />;

    if (status === 'error') return <AuthErrorPanel message={error} onRetry={refresh} />;

    if (status === 'verification-required' || (user && !user.emailVerified)) {
        return <VerifyEmailPage onNavigate={navigate} redirectUrl="/app" />;
    }

    if (user) return <>{children}</>;

    return <LoginPage onNavigate={navigate} redirectUrl="/app" />;
}

/** Branded full-viewport spinner shown while auth state settles. */
function GateSpinner() {
    return (
        <div
            className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[var(--az-bg)]"
            role="status"
            aria-live="polite"
            aria-label="Loading"
        >
            <AzemaxLogo size={34} />
            <div className="flex items-center gap-2.5">
                <span className="az-spinner" aria-hidden="true" />
                <p className="text-[13px] text-[var(--az-text-muted)]">Securing your session…</p>
            </div>
        </div>
    );
}

/**
 * Fail-closed panel for an irrecoverable client auth initialization error.
 * Offers an explicit retry (re-runs the Firebase check) and a full reload.
 */
function AuthErrorPanel({ message, onRetry }: { message: string | null; onRetry: () => Promise<void> }) {
    return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--az-bg)] px-6">
            <div className="w-full max-w-[420px] rounded-xl border border-[var(--az-border)] bg-[var(--az-surface)] p-6 text-center">
                <div className="mb-4 flex items-center justify-center">
                    <AzemaxLogo size={30} />
                </div>
                <h1 className="text-[16px] font-semibold text-[var(--az-text)]">Sign-in is unavailable</h1>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--az-text-muted)]">
                    {message || 'Authentication could not be initialized. The workspace stays locked until this is resolved.'}
                </p>
                <div className="mt-6 space-y-3">
                    <AuthButton onClick={() => void onRetry()}>Retry</AuthButton>
                    <AuthButton variant="secondary" onClick={() => window.location.reload()}>
                        Reload page
                    </AuthButton>
                </div>
            </div>
        </div>
    );
}
