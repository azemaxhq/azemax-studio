/**
 * Firebase ID-token credential holder (frontend).
 *
 * Architecture: Firebase Authentication is the sole identity provider. The
 * Firebase client SDK mints a short-lived ID token which we present as
 * `Authorization: Bearer <idToken>` on every protected API request; the backend
 * verifies it with the Firebase Admin SDK. Firebase itself owns token minting,
 * refresh, and revocation.
 *
 * The token is cached IN MEMORY ONLY — never in localStorage or a cookie. There
 * is no custom session token and no auth-bypass flag. When no token is cached,
 * `authHeaders()` returns no credential and the request fails closed with 401.
 */
import { getCurrentIdToken } from '../core/auth/firebase';

let cachedIdToken: string | null = null;

/** Replace the in-memory ID token (called by the auth listener / sign-in flow). */
export function setIdToken(token: string | null | undefined): void {
    cachedIdToken = typeof token === 'string' && token ? token : null;
}

/** The currently cached ID token, if any (synchronous, memory-backed). */
export function getIdToken(): string | null {
    return cachedIdToken;
}

/** Drop the cached credential (sign-out / account switch). */
export function clearIdToken(): void {
    cachedIdToken = null;
}

/** Bearer header for fetch calls. Empty object when unauthenticated. */
export function authHeaders(): Record<string, string> {
    return cachedIdToken ? { Authorization: `Bearer ${cachedIdToken}` } : {};
}

/**
 * Ensure a fresh credential is cached before a request. Returns the token or
 * null when the user is not signed in / Firebase is unavailable. Uses the
 * SDK-cached token unless `forceRefresh` is requested.
 */
export async function ensureIdToken(forceRefresh = false): Promise<string | null> {
    const token = await getCurrentIdToken(forceRefresh);
    if (token) setIdToken(token);
    return token;
}

/**
 * Attach the credential to a WebSocket URL as `?token=`.
 * Browsers cannot set an Authorization header on `new WebSocket()`, so the
 * server verifies the ID token from the query string at handshake time.
 */
export function withAuthToken(wsUrl: string): string {
    if (!cachedIdToken) return wsUrl;
    try {
        const separator = wsUrl.includes('?') ? '&' : '?';
        return `${wsUrl}${separator}token=${encodeURIComponent(cachedIdToken)}`;
    } catch {
        return wsUrl;
    }
}

/**
 * Classify an auth-request failure into an actionable user message.
 * Pure function (no fetch/storage) so it is unit-testable.
 *
 * - networkError: fetch() itself threw (DNS down, backend asleep, CORS
 *   preflight rejected — browsers surface all three as TypeError).
 * - contentType: response Content-Type, if any (`text/html` means the request
 *   hit the static host instead of the API — VITE_API_URL misconfigured).
 * - status/bodyError: HTTP status + parsed `error` field for real API errors.
 */
export function authFailureMessage(args: {
    networkError?: boolean;
    contentType?: string | null;
    status?: number;
    bodyError?: string | null;
    apiBase?: string;
}): string {
    const { networkError, contentType, status, bodyError, apiBase } = args;
    if (networkError) {
        return (
            'Cannot reach the API server. ' +
            'The backend may be waking up (free-tier cold start takes ~60s — wait and retry), ' +
            'or the request was blocked (check VITE_API_URL and the backend CORS_ORIGIN).'
        );
    }
    if (contentType && contentType.includes('text/html')) {
        return (
            'API misconfigured: the auth request returned a web page instead of JSON. ' +
            `The app is talking to "${apiBase || '/api'}" but no API is there — ` +
            'set VITE_API_URL to your backend URL ending in /api (e.g. https://azemax-api.onrender.com/api) and redeploy the frontend.'
        );
    }
    if (typeof status === 'number') {
        if (status === 401) return 'Your session has expired. Please sign in again.';
        if (status === 403) return bodyError || 'You do not have access to this resource.';
        if (status === 409) return bodyError || 'An account with this email already exists. Sign in instead.';
        if (status === 429) return 'Too many attempts. Wait a minute and try again.';
        if (status === 503) return bodyError || 'Authentication is temporarily unavailable. Try again shortly.';
        if (bodyError) return bodyError;
        return `Request failed (HTTP ${status}). Try again.`;
    }
    return bodyError || 'Request failed. Try again.';
}
