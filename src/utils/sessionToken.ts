/**
 * Bearer-token fallback for session authentication.
 *
 * Primary credential is always the httpOnly `azemax_session` cookie (never
 * visible to JS). This module stores the opaque session token returned by
 * POST /auth/signup and POST /auth/login as a *fallback* for cross-site
 * beta deploys (frontend on Vercel, API on Render), where browsers that
 * block third-party cookies drop the Set-Cookie and would otherwise strand
 * the user at the login gate with no error.
 *
 * The token is only ever sent to API_BASE (https in production) as an
 * `Authorization: Bearer` header (HTTP) or `?token=` query param
 * (WebSocket handshake — cookies cannot be set on `new WebSocket()`).
 * It is revocable server-side via POST /auth/logout and expires with the
 * same sliding SESSION_TTL as the cookie session.
 */

const STORAGE_KEY = 'azemax:session_token';

// In-memory copy so the module works where localStorage is unavailable
// (SSR/tests/private-mode throws) and stays testable under node.
let memoryToken: string | null = null;

function storage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function getSessionToken(): string | null {
    const store = storage();
    if (store) {
        try {
            const value = store.getItem(STORAGE_KEY);
            if (value) {
                memoryToken = value;
                return value;
            }
        } catch {
            /* fall through to memory */
        }
    }
    return memoryToken;
}

export function setSessionToken(token: string | null | undefined): void {
    memoryToken = typeof token === 'string' && token ? token : null;
    const store = storage();
    if (!store) return;
    try {
        if (memoryToken) store.setItem(STORAGE_KEY, memoryToken);
        else store.removeItem(STORAGE_KEY);
    } catch {
        /* quota/private-mode — memory copy still works for this page load */
    }
}

export function clearSessionToken(): void {
    setSessionToken(null);
}

/** Headers carrying the fallback credential (merged into fetch calls). */
export function authHeaders(): Record<string, string> {
    const token = getSessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Attach the fallback credential to a WebSocket URL as `?token=`.
 * The server reads it in tokenFromUpgrade(); the cookie path is untouched.
 */
export function withSessionToken(wsUrl: string): string {
    const token = getSessionToken();
    if (!token) return wsUrl;
    try {
        const separator = wsUrl.includes('?') ? '&' : '?';
        return `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
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
        if (status === 401) return 'Invalid email or password.';
        if (status === 409)
            return 'An account with this email already exists. Sign in instead.';
        if (status === 429)
            return 'Too many attempts. Wait a minute and try again.';
        if (bodyError) return bodyError;
        return `Request failed (HTTP ${status}). Try again.`;
    }
    return bodyError || 'Request failed. Try again.';
}
