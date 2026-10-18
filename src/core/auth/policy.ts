/**
 * Shared authentication input policy for Azemax Studio.
 *
 * One source of truth for the rules enforced by every auth form, so the
 * sign-in, sign-up, and password-reset panes can never drift apart. These are
 * *client-side* UX rules; the server and Firebase remain the real authorities
 * (Firebase enforces its own minimum, the Azemax API enforces >= 10 for local
 * email/password accounts).
 *
 * Password policy (documented):
 *  - minimum 10 characters
 *  - maximum 256 characters (matches the server)
 *  - no composition rules are *required*, but strength guidance rewards length,
 *    mixed case, digits, and symbols
 *  - passwords are never stored in Azemax; Firebase owns credential storage
 */

/** Minimum length enforced by the Azemax forms (>= Firebase's own minimum). */
export const PASSWORD_MIN_LENGTH = 10;

/** Maximum length accepted by the Azemax API (bytes/chars). */
export const PASSWORD_MAX_LENGTH = 256;

/** Pragmatic email shape check (the provider performs the authoritative check). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string | null | undefined): string {
    return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email: string | null | undefined): boolean {
    return EMAIL_RE.test(normalizeEmail(email));
}

export type PasswordStrengthLabel = '' | 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface PasswordStrength {
    /** 0 (empty) .. 4 (strong). */
    score: number;
    label: PasswordStrengthLabel;
}

/**
 * Coarse, non-punitive strength guidance for the sign-up form. Advisory only —
 * `validatePassword` is the gate.
 */
export function passwordStrength(password: string): PasswordStrength {
    if (!password) return { score: 0, label: '' };
    let score = 0;
    if (password.length >= PASSWORD_MIN_LENGTH) score++;
    if (password.length >= 16) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (password.length < PASSWORD_MIN_LENGTH) return { score: 1, label: 'Weak' };
    if (score <= 2) return { score: 1, label: 'Weak' };
    if (score === 3) return { score: 2, label: 'Fair' };
    if (score === 4) return { score: 3, label: 'Good' };
    return { score: 4, label: 'Strong' };
}

/**
 * Validate a password against the documented policy. Returns a human-readable
 * error message, or null when acceptable.
 */
export function validatePassword(password: string): string | null {
    if (typeof password !== 'string' || password.length === 0) {
        return 'Please enter a password.';
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
        return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
        return 'Password is too long.';
    }
    return null;
}
