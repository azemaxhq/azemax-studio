/**
 * Authentication surface copy — one source of truth for page titles and the
 * brand-panel messaging, kept in a pure module so it can be unit-tested and so
 * the panes can never drift apart.
 *
 * `brand` copy appears only on the desktop brand panel (decorative context);
 * `title`/`description` head the actual form and are the pane's <h1>.
 */

export type AuthCopyKey = 'login' | 'signup' | 'verify' | 'forgot';

export interface AuthPageCopy {
    /** Brand-panel headline (desktop only, task-adapted). */
    brandHeadline: string;
    /** Brand-panel supporting line (desktop only). */
    brandSubheadline: string;
    /** Form heading — the pane's <h1>. */
    title: string;
    /** Form supporting line. */
    description: string;
}

export const AUTH_COPY: Record<AuthCopyKey, AuthPageCopy> = {
    login: {
        brandHeadline: 'Build beyond limits.',
        brandSubheadline: 'Pick up your workspaces, agents, and projects exactly where you left off.',
        title: 'Welcome back',
        description: 'Sign in to pick up where you left off.',
    },
    signup: {
        brandHeadline: 'Your studio, ready.',
        brandSubheadline: 'One account for your workspaces, projects, and AI-powered development.',
        title: 'Create your Azemax account',
        description: 'One account for your workspaces, projects, and AI-powered development.',
    },
    verify: {
        brandHeadline: 'Almost there.',
        brandSubheadline: 'Confirm your email to secure your account and unlock account-scoped features.',
        title: 'Verify your email',
        description: 'One quick step to secure your account and protect your workspaces.',
    },
    forgot: {
        brandHeadline: 'Get straight back in.',
        brandSubheadline: 'We will email you a secure link so you can choose a new password.',
        title: 'Reset your password',
        description: 'Enter your email and we will send a secure link to reset your password.',
    },
};
