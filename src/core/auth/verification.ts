/**
 * Email-verification helpers — pure, dependency-free, unit-testable.
 *
 * The verification pane must never claim "we sent a link to <address>" for an
 * address that cannot receive mail. That happens in practice when the app runs
 * against the development auth bypass (`DISABLE_AUTH=true`), whose fixture
 * identity is `local-dev@azemax.local`, or when a session is restored without a
 * provider email at all. Centralising the deliverability rule here keeps every
 * pane honest and gives the tests a single seam.
 */

import { EMAIL_RE, normalizeEmail } from './policy';

/**
 * Reserved / special-use TLDs (RFC 2606, RFC 6761, RFC 6762) plus the
 * `.local` mDNS suffix. Mail is never delivered to these, so they must never be
 * presented as a real verification destination.
 */
const NON_DELIVERABLE_TLDS = [
    '.local',
    '.localhost',
    '.invalid',
    '.test',
    '.example',
    '.internal',
    '.home',
    '.lan',
];

/** Known non-human fixtures that must never be shown as a real address. */
const PLACEHOLDER_ADDRESSES = new Set([
    'local-dev@azemax.local',
    'guest@azemax.local',
]);

export interface VerificationTarget {
    /** The address to show, or null when nothing trustworthy is available. */
    address: string | null;
    /** True when the address could plausibly receive a verification email. */
    deliverable: boolean;
}

/**
 * True when an address is shape-valid AND not a reserved/fixture address.
 * This is a presentation guard, not a security boundary — the provider remains
 * the authority on whether a message was actually accepted.
 */
export function isDeliverableEmail(email: string | null | undefined): boolean {
    const clean = normalizeEmail(email);
    if (!clean || !EMAIL_RE.test(clean)) return false;
    if (PLACEHOLDER_ADDRESSES.has(clean)) return false;
    const domain = clean.slice(clean.lastIndexOf('@') + 1);
    if (NON_DELIVERABLE_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld))) {
        return false;
    }
    return true;
}

/** Resolve the address to display on the verification pane. */
export function verificationTarget(email: string | null | undefined): VerificationTarget {
    const clean = normalizeEmail(email);
    if (isDeliverableEmail(clean)) return { address: clean, deliverable: true };
    return { address: null, deliverable: false };
}

/**
 * Copy-safe label for where a verification link was sent. Falls back to a
 * neutral phrase instead of ever printing a placeholder address.
 */
export function verificationTargetLabel(email: string | null | undefined): string {
    const { address } = verificationTarget(email);
    return address ?? 'your email address';
}

/** Seconds the resend button must stay disabled after a successful send. */
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
