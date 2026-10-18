import React, { useState, useRef, useEffect, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from './AuthLayout';
import {
    AuthAlert,
    AuthButton,
    AuthField,
    AuthFooterRow,
    AuthHeading,
    AuthLinkButton,
} from './primitives';
import { AUTH_COPY } from '../../core/auth/copy';
import { isValidEmail, normalizeEmail } from '../../core/auth/policy';
import { ArrowLeft, Mail, Send } from 'lucide-react';

interface ForgotPasswordPageProps {
    onNavigate: (path: string) => void;
}

type PaneStatus = 'idle' | 'sent' | 'error';

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onNavigate }) => {
    const { sendPasswordResetEmail, error, clearError } = useAuth();
    const copy = AUTH_COPY.forgot;

    const [email, setEmail] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [pane, setPane] = useState<PaneStatus>('idle');
    const [fieldError, setFieldError] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);

    const emailRef = useRef<HTMLInputElement>(null);
    const alertRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        clearError();
    }, [clearError]);

    const activeError = sendError || fieldError || error;

    useEffect(() => {
        if (pane === 'error' && alertRef.current) alertRef.current.focus();
    }, [pane]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        clearError();
        setFieldError(null);
        setSendError(null);

        const cleanEmail = normalizeEmail(email);
        if (!cleanEmail) {
            setFieldError('Enter your email address.');
            emailRef.current?.focus();
            return;
        }
        if (!isValidEmail(cleanEmail)) {
            setFieldError('Enter a valid email address.');
            emailRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            await sendPasswordResetEmail(cleanEmail);
            // Deliberately generic: the same success state whether or not an
            // account exists (no enumeration).
            setPane('sent');
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'Could not send the reset email. Please try again.');
            setPane('error');
        } finally {
            setSubmitting(false);
        }
    };

    const resetToForm = () => {
        setPane('idle');
        setSendError(null);
        setFieldError(null);
        clearError();
    };

    return (
        <AuthLayout
            headline={copy.brandHeadline}
            subheadline={copy.brandSubheadline}
        >
            <AuthLinkButton subtle onClick={() => onNavigate('/login')} className="mb-5 inline-flex items-center gap-1.5">
                <ArrowLeft size={13} aria-hidden="true" />
                Back to sign in
            </AuthLinkButton>

            <AuthHeading title={copy.title} description={copy.description} />

            <div className="mt-6 space-y-4">
                {pane === 'sent' ? (
                    <>
                        <AuthAlert kind="success">
                            <span className="block font-medium">Check your inbox</span>
                            <span className="mt-0.5 block text-[var(--az-text-secondary)]">
                                If an account exists for <strong className="text-[var(--az-text)]">{normalizeEmail(email)}</strong>,
                                a secure password reset link is on its way. Check your spam folder if it does not arrive within a few minutes.
                            </span>
                        </AuthAlert>
                        <AuthButton variant="secondary" onClick={resetToForm}>
                            Send to a different email
                        </AuthButton>
                        <AuthButton variant="primary" onClick={() => onNavigate('/login')}>
                            Return to sign in
                        </AuthButton>
                    </>
                ) : (
                    <>
                        {pane === 'error' && activeError ? (
                            <AuthAlert kind="error" ref={alertRef}>
                                {activeError}
                            </AuthAlert>
                        ) : null}

                        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                            <AuthField
                                id="reset-email"
                                ref={emailRef}
                                label="Email address"
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                required
                                icon={<Mail size={15} />}
                                placeholder="name@example.com"
                                value={email}
                                error={fieldError}
                                disabled={submitting}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (fieldError) setFieldError(null);
                                    if (error) clearError();
                                    if (pane === 'error') setPane('idle');
                                }}
                            />

                            <AuthButton
                                type="submit"
                                loading={submitting}
                                loadingLabel="Sending reset link…"
                            >
                                <span>Send password reset link</span>
                                <Send size={14} aria-hidden="true" />
                            </AuthButton>
                        </form>
                    </>
                )}

                {pane !== 'sent' ? (
                    <AuthFooterRow>
                        <p className="text-center">
                            Remembered it?{' '}
                            <AuthLinkButton onClick={() => onNavigate('/login')} className="text-[12px]">
                                Back to sign in
                            </AuthLinkButton>
                        </p>
                    </AuthFooterRow>
                ) : null}
            </div>
        </AuthLayout>
    );
};
