import React, { useState, useMemo, useRef, useEffect, useCallback, type FormEvent } from 'react';
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
import { LEGAL_PATHS } from '../Legal/legalMeta';
import {
    PASSWORD_MIN_LENGTH,
    isValidEmail,
    normalizeEmail,
    passwordStrength,
    validatePassword,
} from '../../core/auth/policy';
import { ArrowRight, Lock, Mail, ShieldCheck, User } from 'lucide-react';

interface SignupPageProps {
    onNavigate: (path: string) => void;
    redirectUrl?: string;
}

interface FieldErrors {
    email?: string;
    password?: string;
    confirm?: string;
    terms?: string;
}

const TERMS_URL = LEGAL_PATHS.terms;
const PRIVACY_URL = LEGAL_PATHS.privacy;

export const SignupPage: React.FC<SignupPageProps> = ({ onNavigate, redirectUrl = '/app' }) => {
    const { signup, loginWithGoogle, error, clearError, isFirebaseConfigured } = useAuth();
    const copy = AUTH_COPY.signup;

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [confirmTouched, setConfirmTouched] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [googleSubmitting, setGoogleSubmitting] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

    const nameRef = useRef<HTMLInputElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);
    const termsRef = useRef<HTMLInputElement>(null);
    const alertRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        clearError();
    }, [clearError]);

    useEffect(() => {
        if (error) alertRef.current?.focus();
    }, [error]);

    const busy = submitting || googleSubmitting;

    const strength = useMemo(() => passwordStrength(password), [password]);
    const strengthColor =
        strength.score >= 4
            ? 'bg-[var(--az-success)]'
            : strength.score === 3
                ? 'bg-[var(--az-accent)]'
                : strength.score === 2
                    ? 'bg-[var(--az-warning)]'
                    : 'bg-[var(--az-error)]';

    // Live, non-punitive mismatch feedback once the user has left the field.
    const confirmMismatch = confirmTouched && confirmPassword.length > 0 && password !== confirmPassword;
    const confirmError = fieldErrors.confirm || (confirmMismatch ? 'Passwords do not match.' : undefined);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        clearError();

        const cleanEmail = normalizeEmail(email);
        const nextErrors: FieldErrors = {};

        if (!cleanEmail) nextErrors.email = 'Enter your email address.';
        else if (!isValidEmail(cleanEmail)) nextErrors.email = 'Enter a valid email address.';

        const passwordError = validatePassword(password);
        if (passwordError) nextErrors.password = passwordError;
        else if (password !== confirmPassword) nextErrors.confirm = 'Passwords do not match.';

        if (!termsAccepted) nextErrors.terms = 'Accept the Terms of Service and Privacy Policy to continue.';

        setFieldErrors(nextErrors);

        if (nextErrors.email) {
            emailRef.current?.focus();
            return;
        }
        if (nextErrors.password) {
            passwordRef.current?.focus();
            return;
        }
        if (nextErrors.confirm) {
            confirmRef.current?.focus();
            return;
        }
        if (nextErrors.terms) {
            termsRef.current?.focus();
            return;
        }

        setSubmitting(true);
        try {
            const result = await signup(cleanEmail, password, fullName.trim() || undefined);
            if (result.ok) {
                onNavigate(result.status === 'verification-required' ? '/verify-email' : redirectUrl);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogleSignUp = useCallback(async () => {
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

            <div className="mt-6 space-y-4">
                {isFirebaseConfigured ? (
                    <div className="space-y-4">
                        <GoogleButton
                            onClick={handleGoogleSignUp}
                            loading={googleSubmitting}
                            disabled={submitting}
                            text="Sign up with Google"
                        />
                        <AuthDivider label="or register with email" />
                    </div>
                ) : null}

                {error ? (
                    <AuthAlert kind="error" ref={alertRef}>
                        {error}
                    </AuthAlert>
                ) : null}

                <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
                    <AuthField
                        id="signup-name"
                        ref={nameRef}
                        label="Full name (optional)"
                        type="text"
                        autoComplete="name"
                        maxLength={80}
                        icon={<User size={15} />}
                        placeholder="Ada Lovelace"
                        value={fullName}
                        disabled={busy}
                        onChange={(e) => setFullName(e.target.value)}
                    />

                    <AuthField
                        id="signup-email"
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

                    <div>
                        <PasswordField
                            id="signup-password"
                            ref={passwordRef}
                            label="Password"
                            autoComplete="new-password"
                            required
                            minLength={PASSWORD_MIN_LENGTH}
                            icon={<Lock size={15} />}
                            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                            value={password}
                            error={fieldErrors.password}
                            hint={`At least ${PASSWORD_MIN_LENGTH} characters — longer is stronger.`}
                            disabled={busy}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                                if (error) clearError();
                            }}
                        />
                        {password ? (
                            <div className="mt-2 flex items-center gap-2" aria-hidden="true">
                                <div className="flex h-1 flex-1 gap-1 overflow-hidden rounded-full bg-[var(--az-surface-hover)]">
                                    {[1, 2, 3, 4].map((step) => (
                                        <div
                                            key={step}
                                            className={`h-full flex-1 rounded-full ${
                                                strength.score >= step ? strengthColor : 'bg-transparent'
                                            }`}
                                        />
                                    ))}
                                </div>
                                <span className="w-12 text-right text-[10.5px] font-medium text-[var(--az-text-muted)]">
                                    {strength.label}
                                </span>
                            </div>
                        ) : null}
                    </div>

                    <PasswordField
                        id="signup-confirm-password"
                        ref={confirmRef}
                        label="Confirm password"
                        autoComplete="new-password"
                        required
                        icon={<ShieldCheck size={15} />}
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        error={confirmError}
                        disabled={busy}
                        onBlur={() => setConfirmTouched(true)}
                        onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (fieldErrors.confirm) setFieldErrors((p) => ({ ...p, confirm: undefined }));
                        }}
                    />

                    <div className="pt-0.5">
                        <div className="flex items-start gap-2.5">
                            <input
                                id="terms-checkbox"
                                ref={termsRef}
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(e) => {
                                    setTermsAccepted(e.target.checked);
                                    if (fieldErrors.terms) setFieldErrors((p) => ({ ...p, terms: undefined }));
                                }}
                                aria-invalid={fieldErrors.terms ? true : undefined}
                                aria-describedby={fieldErrors.terms ? 'terms-error' : undefined}
                                className="az-ring mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--az-border)] bg-[var(--az-surface-input)] accent-[var(--az-accent)]"
                            />
                            <label htmlFor="terms-checkbox" className="text-[12px] leading-snug text-[var(--az-text-muted)]">
                                I agree to the{' '}
                                <a
                                    href={TERMS_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="az-ring rounded text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 hover:text-[var(--az-accent-hover)]"
                                >
                                    Terms of Service
                                </a>{' '}
                                and{' '}
                                <a
                                    href={PRIVACY_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="az-ring rounded text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 hover:text-[var(--az-accent-hover)]"
                                >
                                    Privacy Policy
                                </a>
                                .
                            </label>
                        </div>
                        {fieldErrors.terms ? (
                            <p
                                id="terms-error"
                                role="alert"
                                className="mt-1.5 text-[11.5px] leading-snug text-[var(--az-error)]"
                            >
                                {fieldErrors.terms}
                            </p>
                        ) : null}
                    </div>

                    <AuthButton
                        type="submit"
                        loading={submitting}
                        loadingLabel="Creating account…"
                        disabled={googleSubmitting}
                        className="mt-1"
                    >
                        <span>Create account</span>
                        <ArrowRight size={15} aria-hidden="true" />
                    </AuthButton>
                </form>

                <AuthFooterRow>
                    <p className="text-center">
                        Already have an account?{' '}
                        <AuthLinkButton onClick={() => onNavigate('/login')} className="text-[12px]">
                            Sign in
                        </AuthLinkButton>
                    </p>
                </AuthFooterRow>
            </div>
        </AuthLayout>
    );
};
