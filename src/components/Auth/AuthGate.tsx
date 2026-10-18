import { useState, type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoginPage } from './LoginPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { navigate } from '../../utils/appRouter';
import { AUTH_DISABLED } from '../../utils/sessionToken';
import {
    PUBLIC_BETA,
    isBetaBannerDismissed,
    dismissBetaBanner,
} from '../../utils/betaAccess';

/**
 * Authentication gate for the /app workspace.
 *
 * PUBLIC BETA (default): there is NO login wall. Children render immediately
 * for everyone — signed-in users get their account, anonymous visitors get a
 * local-only guest workspace (files persist in this browser only). Sign-in
 * stays OPTIONAL via the /login route.
 *
 * HARD WALL (VITE_PUBLIC_BETA=false): the premium sign-in / sign-up flows
 * block the workspace until authentication succeeds. Unverified accounts are
 * routed to the verification pane.
 *
 * Legacy VITE_DISABLE_AUTH=true bypasses both and renders children directly
 * with the shared local-dev identity.
 */
export function AuthGate({ children }: { children: ReactNode }) {
    if (AUTH_DISABLED) return <>{children}</>;
    if (PUBLIC_BETA) return <BetaWorkspace>{children}</BetaWorkspace>;
    return <GatedAuthGate>{children}</GatedAuthGate>;
}

/**
 * Open-workspace shell: renders the editor immediately (even while the
 * session check is in flight — never a blank waiter, never a redirect) plus
 * dismissible notices about guest storage and pending email verification.
 */
function BetaWorkspace({ children }: { children: ReactNode }) {
    const { isAnonymous, status } = useAuth();
    const [dismissed, setDismissed] = useState<boolean>(() => isBetaBannerDismissed());
    const [verifyDismissed, setVerifyDismissed] = useState(false);
    const showGuestBanner = isAnonymous && !dismissed;
    const showVerifyBanner = status === 'verification-required' && !verifyDismissed;

    const dismiss = () => {
        dismissBetaBanner();
        setDismissed(true);
    };

    return (
        <>
            {showGuestBanner && (
                <div
                    role="note"
                    aria-label="Public beta guest notice"
                    data-testid="beta-anon-banner"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
                        padding: '7px 16px', fontSize: '12px', color: 'var(--az-text-secondary)',
                        background: 'var(--az-surface-2)', borderBottom: '1px solid var(--az-border-subtle)',
                    }}
                >
                    <span>
                        <strong style={{ color: 'var(--az-text)', fontWeight: 600 }}>Public beta</strong>
                        {' — '}guest workspace saved in this browser only; clearing site data or switching devices loses it.
                        {' '}
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--az-accent)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            Sign in
                        </button>
                        {' '}for higher AI &amp; execution limits.
                    </span>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss guest notice"
                        style={{ background: 'none', border: 'none', padding: '4px 6px', color: 'var(--az-text-muted)', fontSize: '12px', cursor: 'pointer' }}
                    >
                        Dismiss
                    </button>
                </div>
            )}
            {showVerifyBanner && (
                <div
                    role="alert"
                    data-testid="verify-email-banner"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
                        padding: '7px 16px', fontSize: '12px', color: 'var(--az-warning)',
                        background: 'var(--az-surface-2)', borderBottom: '1px solid var(--az-border-subtle)',
                    }}
                >
                    <span>
                        Verify your email to secure your account and enable account-scoped features.
                        {' '}
                        <button
                            type="button"
                            onClick={() => navigate('/verify-email')}
                            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--az-accent)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}
                        >
                            Verify now
                        </button>
                    </span>
                    <button
                        type="button"
                        onClick={() => setVerifyDismissed(true)}
                        aria-label="Dismiss verification notice"
                        style={{ background: 'none', border: 'none', padding: '4px 6px', color: 'var(--az-text-muted)', fontSize: '12px', cursor: 'pointer' }}
                    >
                        Dismiss
                    </button>
                </div>
            )}
            {children}
        </>
    );
}

/**
 * Hard login wall (VITE_PUBLIC_BETA=false). Reuses the same premium auth
 * panes as the /login and /verify-email routes so the experience is identical
 * whether the wall is entered via /app or the auth routes.
 */
function GatedAuthGate({ children }: { children: ReactNode }) {
    const { user, loading, status } = useAuth();

    if (loading) {
        return (
            <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--az-bg)' }} role="status" aria-live="polite" aria-label="Loading">
                <div className="w-6 h-6 border-2 border-[var(--az-accent)]/25 border-t-[var(--az-accent)] rounded-full animate-spin" />
            </div>
        );
    }

    if (user && status === 'verification-required') {
        return <VerifyEmailPage onNavigate={navigate} redirectUrl="/app" />;
    }

    if (user) return <>{children}</>;

    return <LoginPage onNavigate={navigate} redirectUrl="/app" />;
}
