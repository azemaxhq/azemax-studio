import React from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Authentication UI primitives.
 *
 * Every auth pane is built from these so heights, radii, spacing, focus rings,
 * loading/disabled states, and message styling stay identical across login,
 * sign-up, verification, and password recovery (no drifting one-off variants).
 *
 * Accessibility is baked in: explicit labels, `aria-invalid` +
 * `aria-describedby` wiring for field errors, live regions for async
 * messages, and a single centralised focus-ring utility (`.az-ring`).
 */

/* ------------------------------------------------------------------ heading */

export const AuthHeading: React.FC<{
    title: string;
    description?: string;
    id?: string;
}> = ({ title, description, id }) => (
    <div className="space-y-1.5">
        <h1
            id={id}
            className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[var(--az-text)] sm:text-[26px]"
        >
            {title}
        </h1>
        {description ? (
            <p className="text-[13.5px] leading-relaxed text-[var(--az-text-muted)]">{description}</p>
        ) : null}
    </div>
);

/* -------------------------------------------------------------------- alert */

type AlertKind = 'error' | 'success' | 'info';

const ALERT_STYLES: Record<AlertKind, { box: string; icon: string; Icon: typeof AlertCircle }> = {
    error: {
        box: 'border-[var(--az-error-border)] bg-[var(--az-error-soft)] text-[var(--az-error)]',
        icon: 'text-[var(--az-error)]',
        Icon: AlertCircle,
    },
    success: {
        box: 'border-[var(--az-success-border)] bg-[var(--az-success-soft)] text-[var(--az-success)]',
        icon: 'text-[var(--az-success)]',
        Icon: CheckCircle2,
    },
    info: {
        box: 'border-[var(--az-border)] bg-[var(--az-surface-2)] text-[var(--az-text-secondary)]',
        icon: 'text-[var(--az-info)]',
        Icon: Info,
    },
};

export const AuthAlert = React.forwardRef<
    HTMLDivElement,
    {
        kind?: AlertKind;
        children: React.ReactNode;
        id?: string;
        className?: string;
    }
>(function AuthAlert({ kind = 'error', children, id, className }, ref) {
    const style = ALERT_STYLES[kind];
    const Icon = style.Icon;
    return (
        <div
            id={id}
            ref={ref}
            role={kind === 'error' ? 'alert' : 'status'}
            aria-live={kind === 'error' ? 'assertive' : 'polite'}
            tabIndex={-1}
            className={cn(
                'az-auth-fade az-ring flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-snug outline-none',
                style.box,
                className,
            )}
        >
            <Icon size={16} className={cn('mt-0.5 shrink-0', style.icon)} aria-hidden="true" />
            <span className="min-w-0 flex-1">{children}</span>
        </div>
    );
});

/* -------------------------------------------------------------------- field */

export interface AuthFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
    id: string;
    label: string;
    icon?: React.ReactNode;
    /** Field-level error — also surfaces on the input via aria-invalid. */
    error?: string | null;
    /** Persistent helper text (hidden while an error is shown). */
    hint?: string;
    /** Trailing control (e.g. password visibility toggle). */
    trailing?: React.ReactNode;
    labelAction?: React.ReactNode;
}

export const AuthField = React.forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
    { id, label, icon, error, hint, trailing, labelAction, className, ...rest },
    ref,
) {
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
        .filter(Boolean)
        .join(' ');

    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={id} className="text-[12px] font-medium text-[var(--az-text-secondary)]">
                    {label}
                </label>
                {labelAction}
            </div>
            <div className="relative">
                {icon ? (
                    <span
                        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--az-text-muted)]"
                        aria-hidden="true"
                    >
                        {icon}
                    </span>
                ) : null}
                <input
                    id={id}
                    ref={ref}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy || undefined}
                    className={cn(
                        'mobile-no-zoom az-ring h-10 w-full rounded-lg border bg-[var(--az-surface-input)] text-[14px]',
                        'text-[var(--az-text)] placeholder:text-[var(--az-text-disabled)]',
                        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        icon ? 'pl-9' : 'pl-3.5',
                        trailing ? 'pr-10' : 'pr-3.5',
                        error
                            ? 'border-[var(--az-error-border)]'
                            : 'border-[var(--az-border)] hover:border-[var(--az-border-strong)]',
                        className,
                    )}
                    {...rest}
                />
                {trailing ? (
                    <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">{trailing}</div>
                ) : null}
            </div>
            {/*
              A stable message row. Reserving its height means switching between
              "no message", a hint, and a validation error never reflows the
              fields below — which previously moved controls out from under the
              user mid-interaction (e.g. clicking the terms checkbox while the
              password-confirmation error appeared).
            */}
            <div className="min-h-[16px]">
                {error ? (
                    <p id={errorId} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--az-error)]">
                        <AlertCircle size={12} className="mt-[3px] shrink-0" aria-hidden="true" />
                        <span>{error}</span>
                    </p>
                ) : hint ? (
                    <p id={hintId} className="text-[11.5px] leading-snug text-[var(--az-text-muted)]">
                        {hint}
                    </p>
                ) : null}
            </div>
        </div>
    );
});

/* -------------------------------------------------------------- icon button */

export const AuthIconButton: React.FC<{
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}> = ({ label, onClick, children, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cn(
            'az-ring flex h-7 w-7 items-center justify-center rounded-md text-[var(--az-text-muted)]',
            'transition-colors hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text)]',
            className,
        )}
    >
        {children}
    </button>
);

/* ----------------------------------------------------------- password field */

export type PasswordFieldProps = Omit<AuthFieldProps, 'type' | 'trailing'>;

export const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
    function PasswordField(props, ref) {
        const [visible, setVisible] = React.useState(false);
        return (
            <AuthField
                {...props}
                ref={ref}
                type={visible ? 'text' : 'password'}
                trailing={
                    <AuthIconButton
                        label={visible ? 'Hide password' : 'Show password'}
                        onClick={() => setVisible((v) => !v)}
                    >
                        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </AuthIconButton>
                }
            />
        );
    },
);

/* ------------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface AuthButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    loading?: boolean;
    loadingLabel?: string;
    block?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
    primary:
        'bg-[var(--az-accent)] text-white shadow-[var(--az-shadow-sm)] hover:bg-[var(--az-accent-hover)]',
    secondary:
        'border border-[var(--az-border)] bg-[var(--az-surface-2)] text-[var(--az-text)] hover:bg-[var(--az-surface-hover)] hover:border-[var(--az-border-strong)]',
    ghost:
        'text-[var(--az-text-secondary)] hover:bg-[var(--az-surface-hover)] hover:text-[var(--az-text)]',
};

export const AuthButton: React.FC<AuthButtonProps> = ({
    variant = 'primary',
    loading = false,
    loadingLabel = 'Please wait…',
    block = true,
    disabled,
    children,
    className,
    type = 'button',
    ...rest
}) => (
    <button
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
            'az-ring inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-medium',
            'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
            block && 'w-full',
            BUTTON_VARIANTS[variant],
            className,
        )}
        {...rest}
    >
        {loading ? (
            <>
                <span className="az-spinner" aria-hidden="true" />
                <span>{loadingLabel}</span>
            </>
        ) : (
            children
        )}
    </button>
);

/* ------------------------------------------------------------------ divider */

export const AuthDivider: React.FC<{ label: string }> = ({ label }) => (
    <div className="flex items-center" role="separator" aria-label={label}>
        <div className="h-px flex-1 bg-[var(--az-border-subtle)]" />
        <span className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--az-text-muted)]">
            {label}
        </span>
        <div className="h-px flex-1 bg-[var(--az-border-subtle)]" />
    </div>
);

/* --------------------------------------------------------------- text action */

export const AuthLinkButton: React.FC<{
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
    subtle?: boolean;
}> = ({ onClick, children, className, subtle = false }) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'az-ring rounded-md transition-colors',
            subtle
                ? 'text-[12px] text-[var(--az-text-muted)] hover:text-[var(--az-text)]'
                : 'text-[13px] font-medium text-[var(--az-accent)] hover:text-[var(--az-accent-hover)]',
            className,
        )}
    >
        {children}
    </button>
);

/* ------------------------------------------------------------------- footer */

export const AuthFooterRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="border-t border-[var(--az-border-subtle)] pt-4 text-[12px] text-[var(--az-text-muted)]">
        {children}
    </div>
);
