import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from './AuthLayout';
import {
    AuthAlert,
    AuthButton,
    AuthFooterRow,
    AuthHeading,
    AuthLinkButton,
} from './primitives';
import { AUTH_COPY } from '../../core/auth/copy';
import {
    VERIFICATION_RESEND_COOLDOWN_SECONDS,
    verificationTarget,
} from '../../core/auth/verification';
import { ArrowRight, CheckCircle2, LogOut, Mail, RefreshCw } from 'lucide-react';

interface VerifyEmailPageProps {
    onNavigate: (path: string) => void;
    redirectUrl?: string;
}

type Notice = { kind: 'success' | 'info' | 'error'; text: string } | null;

export const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({ onNavigate, redirectUrl = '/app' }) => {
    const { user, firebaseUser, resendVerification, checkVerification, logout, error, clearError } = useAuth();
    const copy = AUTH_COPY.verify;

    const [resending, setResending] = useState(false);
    const [checking, setChecking] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [notice, setNotice] = useState<Notice>(null);
    const navigateTimer = useRef<number | null>(null);

    // Which address (if any) can genuinely receive a verification message.
    const target = verificationTarget(firebaseUser?.email || user?.email || null);
    const hasSession = Boolean(user || firebaseUser);
    const canResend = Boolean(firebaseUser);

    // Resend cooldown countdown.
    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = window.setInterval(() => setCooldown((prev) => Math.max(0, prev - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [cooldown]);

    // Never leave a pending redirect timer behind (avoids navigating after the
    // user has already moved on or signed out).
    useEffect(() => () => {
        if (navigateTimer.current !== null) window.clearTimeout(navigateTimer.current);
    }, []);

    const handleCheckVerification = useCallback(async () => {
        if (checking) return;
        clearError();
        setNotice(null);
        setChecking(true);
        try {
            const verified = await checkVerification();
            if (verified) {
                setNotice({ kind: 'success', text: 'Email verified. Taking you to your workspace…' });
                navigateTimer.current = window.setTimeout(() => onNavigate(redirectUrl), 900);
            } else {
                setNotice({
                    kind: 'info',
                    text: 'Not verified yet. Open the link in the message we sent, then check again — it can take a moment to register.',
                });
            }
        } catch {
            setNotice({
                kind: 'error',
                text: 'We could not confirm your status right now. Check your connection and try again.',
            });
        } finally {
            setChecking(false);
        }
    }, [checking, clearError, checkVerification, onNavigate, redirectUrl]);

    const handleResend = useCallback(async () => {
        if (cooldown > 0 || resending) return;
        if (!canResend) {
            setNotice({
                kind: 'error',
                text: 'Resending is unavailable for this session. Sign in again to request a new verification link.',
            });
            return;
        }
        clearError();
        setNotice(null);
        setResending(true);
        try {
            await resendVerification();
            setNotice({
                kind: 'success',
                text: `A new verification link is on its way to ${target.address ?? 'your email address'}.`,
            });
            setCooldown(VERIFICATION_RESEND_COOLDOWN_SECONDS);
        } catch {
            // The auth context records the mapped, user-facing reason (rate
            // limit, network, provider config) — surfaced below.
        } finally {
            setResending(false);
        }
    }, [cooldown, resending, canResend, clearError, resendVerification, target.address]);

    const handleSignOut = useCallback(async () => {
        await logout();
        onNavigate('/login');
    }, [logout, onNavigate]);

    // ------------------------------------------------------- session expired
    if (!hasSession) {
        return (
            <AuthLayout headline={copy.brandHeadline} subheadline={copy.brandSubheadline}>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--az-border)] bg-[var(--az-surface-2)] text-[var(--az-text-muted)]">
                    <Mail size={22} aria-hidden="true" />
                </div>
                <AuthHeading
                    title="Your session has ended"
                    description="Sign in again to continue verifying your email address."
                />
                <div className="mt-6 space-y-4">
                    <AuthButton onClick={() => onNavigate('/login')}>
                        <span>Return to sign in</span>
                        <ArrowRight size={15} aria-hidden="true" />
                    </AuthButton>
                </div>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout headline={copy.brandHeadline} subheadline={copy.brandSubheadline}>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--az-accent-border)] bg-[var(--az-accent-soft-subtle)] text-[var(--az-accent)]">
                <Mail size={22} aria-hidden="true" />
            </div>

            <AuthHeading title={copy.title} description={copy.description} />

            <div className="mt-6 space-y-4">
                {target.address ? (
                    <p className="text-[13px] leading-relaxed text-[var(--az-text-secondary)]">
                        We sent a verification link to{' '}
                        <strong className="font-medium text-[var(--az-text)]">{target.address}</strong>. Open that
                        message and follow the link to activate your account.
                    </p>
                ) : (
                    <AuthAlert kind="info">
                        This session has no deliverable email address on file, so no verification message can be sent
                        here. If you created this account with an email and password, sign in again to receive a fresh
                        link.
                    </AuthAlert>
                )}

                <ol className="space-y-1.5 rounded-lg border border-[var(--az-border-subtle)] bg-[var(--az-surface-2)]/50 p-3.5 text-[12px] text-[var(--az-text-muted)]">
                    <li className="flex gap-2">
                        <span className="font-mono text-[var(--az-text-faint)]">1</span>
                        Open the verification email (check spam if it is missing).
                    </li>
                    <li className="flex gap-2">
                        <span className="font-mono text-[var(--az-text-faint)]">2</span>
                        Follow the link inside to confirm your address.
                    </li>
                    <li className="flex gap-2">
                        <span className="font-mono text-[var(--az-text-faint)]">3</span>
                        Return here and check your status.
                    </li>
                </ol>

                {notice ? (
                    <AuthAlert kind={notice.kind}>{notice.text}</AuthAlert>
                ) : null}

                {error ? <AuthAlert kind="error">{error}</AuthAlert> : null}

                <AuthButton
                    onClick={handleCheckVerification}
                    loading={checking}
                    loadingLabel="Checking status…"
                    disabled={!firebaseUser && !user}
                >
                    <CheckCircle2 size={15} aria-hidden="true" />
                    <span>I&apos;ve verified my email</span>
                    {!checking ? <ArrowRight size={15} aria-hidden="true" /> : null}
                </AuthButton>

                <AuthButton
                    variant="secondary"
                    onClick={handleResend}
                    loading={resending}
                    loadingLabel="Sending…"
                    disabled={cooldown > 0 || !canResend}
                >
                    <RefreshCw size={14} aria-hidden="true" />
                    <span>
                        {cooldown > 0
                            ? `Resend in ${cooldown}s`
                            : 'Resend verification email'}
                    </span>
                </AuthButton>

                <AuthFooterRow>
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="az-ring inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[12px] text-[var(--az-text-muted)] transition-colors hover:text-[var(--az-text)]"
                        >
                            <LogOut size={13} aria-hidden="true" />
                            <span>Sign out</span>
                        </button>
                        <AuthLinkButton subtle onClick={() => onNavigate('/login')} className="text-[12px]">
                            Use a different account
                        </AuthLinkButton>
                    </div>
                </AuthFooterRow>
            </div>
        </AuthLayout>
    );
};
