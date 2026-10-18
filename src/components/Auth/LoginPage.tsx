import React, { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuthLayout } from './AuthLayout';
import { GoogleButton } from './GoogleButton';
import {
    AuthAlert,
    AuthButton,
    AuthDivider,
    AuthField,
    AuthFooterRow,
    AuthHeading,
    AuthLinkButton,
    PasswordField,
} from './primitives';
import { AUTH_COPY } from '../../core/auth/copy';
import { isValidEmail, normalizeEmail } from '../../core/auth/policy';
import { ArrowRight, Lock, Mail } from 'lucide-react';

interface LoginPageProps {
    onNavigate: (path: string) => void;
    redirectUrl?: string;
}

interface FieldErrors {
    email?: string;
    password?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigate, redirectUrl = '/app' }) => {
    const { login, loginWithGoogle, error, clearError, isFirebaseConfigured } = useAuth();
    const copy = AUTH_COPY.login;

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [googleSubmitting, setGoogleSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const alertRef = useRef<HTMLDivElement>(null);

    // A provider error must not outlive the pane the user navigated from.
    useEffect(() => {
        clearError();
    }, [clearError]);

    // Move focus to a freshly surfaced provider failure (visible + announced).
    useEffect(() => {
        if (error) alertRef.current?.focus();
    }, [error]);

    const busy = submitting || googleSubmitting;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        clearError();

        const cleanEmail = normalizeEmail(email);
        const nextErrors: FieldErrors = {};
        if (!cleanEmail) nextErrors.email = 'Enter your email address.';
        else if (!isValidEmail(cleanEmail)) nextErrors.email = 'Enter a valid email address.';

        if (!password) nextErrors.password = 'Enter your password.';

        setFieldErrors(nextErrors);
        if (nextErrors.email) {
            emailRef.current?.focus();
            return;
        }
        if (nextErrors.password) {
            passwordRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            const result = await login(cleanEmail, password);
            if (result.ok) {
                onNavigate(result.status === 'verification-required' ? '/verify-email' : redirectUrl);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogleSignIn = useCallback(async () => {
        if (busy) return;
        clearError();
        setFieldErrors({});
        setGoogleSubmitting(true);
        try {
            const result = await loginWithGoogle();
            if (result.ok) {
                onNavigate(result.status === 'verification-required' ? '/verify-email' : redirectUrl);
            }
        } finally {
            setGoogleSubmitting(false);
        }
    }, [busy, clearError, loginWithGoogle, onNavigate, redirectUrl]);

    return (
        <AuthLayout headline={copy.brandHeadline} subheadline={copy.brandSubheadline}>
            <AuthHeading title={copy.title} description={copy.description} />

            <div className="mt-7 space-y-5">
                {isFirebaseConfigured ? (
                    <div className="space-y-4">
                        <GoogleButton
                            onClick={handleGoogleSignIn}
                            loading={googleSubmitting}
                            disabled={submitting}
                        />
                        <AuthDivider label="or continue with email" />
                    </div>
                ) : null}

                {error ? (
                    <AuthAlert kind="error" ref={alertRef}>
                        {error}
                    </AuthAlert>
                ) : null}

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                    <AuthField
                        id="login-email"
                        ref={emailRef}
                        label="Email address"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        required
                        icon={<Mail size={15} />}
                        placeholder="name@example.com"
                        value={email}
                        error={fieldErrors.email}
                        disabled={busy}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                            if (error) clearError();
                        }}
                    />

                    <PasswordField
                        id="login-password"
                        ref={passwordRef}
                        label="Password"
                        autoComplete="current-password"
                        required
                        icon={<Lock size={15} />}
                        placeholder="••••••••••••"
                        value={password}
                        error={fieldErrors.password}
                        disabled={busy}
                        labelAction={
                            <AuthLinkButton
                                subtle
                                onClick={() => onNavigate('/forgot-password')}
                                className="text-[12px]"
                            >
                                Forgot password?
                            </AuthLinkButton>
                        }
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                            if (error) clearError();
                        }}
                    />

                    <AuthButton
                        type="submit"
                        loading={submitting}
                        loadingLabel="Signing in…"
                        disabled={googleSubmitting}
                        className="mt-1"
                    >
                        <span>Sign in</span>
                        <ArrowRight size={15} aria-hidden="true" />
                    </AuthButton>
                </form>

                <AuthFooterRow>
                    <p className="text-center">
                        New to Azemax?{' '}
                        <AuthLinkButton
                            onClick={() => onNavigate('/signup')}
                            className="text-[12px]"
                        >
                            Create an account
                        </AuthLinkButton>
                    </p>
                </AuthFooterRow>
            </div>
        </AuthLayout>
    );
};
