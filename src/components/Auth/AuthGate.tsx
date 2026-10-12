import React, { useState, type ReactNode, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BRAND } from '../../core/branding';
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
 * stays OPTIONAL via `OptionalAuthForm` (embedded in settings / header).
 *
 * HARD WALL (VITE_PUBLIC_BETA=false): the classic sign-in / sign-up form
 * blocks the workspace until authentication succeeds. Kept for deployments
 * that require accounts.
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
 * a dismissible one-line notice that guest work lives in this browser only.
 */
function BetaWorkspace({ children }: { children: ReactNode }) {
    const { isAnonymous } = useAuth();
    const [dismissed, setDismissed] = useState<boolean>(() => isBetaBannerDismissed());
    const showBanner = isAnonymous && !dismissed;

    const dismiss = () => {
        dismissBetaBanner();
        setDismissed(true);
    };

    return (
        <>
            {showBanner && (
                <div
                    role="note"
                    aria-label="Public beta guest notice"
                    data-testid="beta-anon-banner"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
                        padding: '7px 16px', fontSize: '12px', color: '#A7B0BF',
                        background: '#0E1420', borderBottom: '1px solid rgba(255,255,255,0.07)',
                    }}
                >
                    <span>
                        <strong style={{ color: '#F1F5F9', fontWeight: 600 }}>Public beta</strong>
                        {' — '}guest workspace saved in this browser only; clearing site data or switching devices loses it.
                        {' '}Sign in (optional) for higher AI &amp; execution limits.
                    </span>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss guest notice"
                        style={{ background: 'none', border: 'none', padding: '4px 6px', color: '#727D8E', fontSize: '12px', cursor: 'pointer' }}
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
 * Optional sign-in / sign-up form. Rendered on demand (settings, header)
 * in public beta — never as a workspace blocker.
 */
export function OptionalAuthForm({ onDone }: { onDone?: () => void }) {
    const { error, login, signup, clearError } = useAuth();
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
            const ok = mode === 'login'
                ? await login(email.trim(), password)
                : await signup(email.trim(), password, displayName.trim() || undefined);
            if (ok) {
                setDone(true);
                onDone?.();
            }
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <p role="status" style={{ fontSize: '13px', color: '#7EE2A8' }}>
                Signed in — your workspace now syncs to your account.
            </p>
        );
    }

    return (
        <div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {mode === 'signup' && (
                    <div>
                        <label htmlFor="auth-name" style={labelStyle}>Display name <span style={{ color: '#727D8E' }}>(optional)</span></label>
                        <input id="auth-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                            autoComplete="nickname" maxLength={80} style={inputStyle} />
                    </div>
                )}
                <div>
                    <label htmlFor="auth-email" style={labelStyle}>Email</label>
                    <input id="auth-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearError(); }}
                        autoComplete="email" required maxLength={254} style={inputStyle} />
                </div>
                <div>
                    <label htmlFor="auth-password" style={labelStyle}>Password {mode === 'signup' && <span style={{ color: '#727D8E' }}>(min 10 characters)</span>}</label>
                    <input id="auth-password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); clearError(); }}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required minLength={mode === 'signup' ? 10 : 1} maxLength={256} style={inputStyle} />
                </div>
                {error && (
                    <p role="alert" style={{ fontSize: '12.5px', color: '#FF8A9D', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '8px', padding: '9px 12px', margin: 0 }}>
                        {error}
                    </p>
                )}
                <button type="submit" disabled={busy} style={buttonStyle(busy)}>
                    {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
                </button>
            </form>
            <p style={{ fontSize: '12.5px', color: '#727D8E', textAlign: 'center', marginTop: '18px' }}>
                {mode === 'login' ? (
                    <>New to Azemax? <button type="button" onClick={() => { setMode('signup'); clearError(); }} style={linkStyle}>Create an account</button></>
                ) : (
                    <>Already have an account? <button type="button" onClick={() => { setMode('login'); clearError(); }} style={linkStyle}>Sign in</button></>
                )}
            </p>
        </div>
    );
}

function GatedAuthGate({ children }: { children: ReactNode }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0B0E13' }} role="status" aria-live="polite" aria-label="Loading">
                <AzemaxLogo size={40} />
            </div>
        );
    }

    if (user) return <>{children}</>;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0E13', padding: '24px' }}>
            <main style={{ width: '100%', maxWidth: '380px' }} aria-labelledby="auth-title">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
                    <AzemaxLogo size={44} />
                    <h1 id="auth-title" style={{ fontSize: '20px', fontWeight: 650, color: '#F1F5F9', letterSpacing: '-0.01em', margin: 0 }}>{BRAND.name}</h1>
                    <p style={{ fontSize: '13px', color: '#727D8E', margin: 0 }}>
                        Sign in to your workspace
                    </p>
                </div>
                <OptionalAuthForm />
            </main>
        </div>
    );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#A7B0BF', marginBottom: '6px' };

const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', fontSize: '14px', color: '#F1F5F9',
    background: '#10141B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    padding: '10px 12px', outline: 'none',
};

const buttonStyle = (busy: boolean): React.CSSProperties => ({
    marginTop: '4px', padding: '11px 14px', fontSize: '14px', fontWeight: 600, color: '#fff',
    background: busy ? '#3D5BBF' : '#5B8CFF', border: 'none', borderRadius: '8px',
    cursor: busy ? 'wait' : 'pointer',
});

const linkStyle: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, color: '#5B8CFF', fontSize: '12.5px',
    cursor: 'pointer', textDecoration: 'underline',
};
