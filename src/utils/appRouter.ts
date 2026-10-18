/**
 * Minimal client-side router helpers for Azemax Studio.
 *
 * Azemax does not use a routing library: App.tsx derives the active view from
 * `window.location.pathname` and re-renders on `popstate`. These helpers add
 * two things on top of that model, with no new dependency:
 *
 *  - `navigate(path)`: SPA push without a full reload. It updates the URL and
 *    dispatches a synthetic `popstate` event so the existing App listener
 *    picks the change up (browsers do not fire popstate for pushState).
 *  - `isAuthRoutePath(pathname)` / `safeRedirectTarget(raw)`: pure predicates
 *    for the authentication surface, unit-testable under node.
 *
 * Security: `safeRedirectTarget` is the single gate for post-login
 * destinations. It only ever returns a same-origin, absolute-path route
 * (never `//host`, never an absolute URL, never an auth route), which prevents
 * open redirects and login loops.
 */

/** Authentication routes rendered by AuthRoutes. */
export const AUTH_ROUTES = [
    '/login',
    '/signup',
    '/forgot-password',
    '/verify-email',
    '/auth/callback',
] as const;

/** Default post-authentication destination. */
export const DEFAULT_AUTH_REDIRECT = '/app';

/** True for the exact auth routes above (segment-exact, no prefix bleed). */
export function isAuthRoutePath(pathname: string): boolean {
    if (typeof pathname !== 'string') return false;
    const clean = pathname.length > 1 && pathname.endsWith('/')
        ? pathname.slice(0, -1)
        : pathname;
    return (AUTH_ROUTES as readonly string[]).includes(clean);
}

/**
 * Validate a requested post-login destination. Only same-origin absolute
 * paths are allowed; anything else (absolute URLs, scheme-relative `//evil`,
 * backslash tricks, auth routes) falls back to `/app`.
 */
export function safeRedirectTarget(raw: string | null | undefined): string {
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_AUTH_REDIRECT;
    if (raw.length > 512) return DEFAULT_AUTH_REDIRECT;
    // Must be an absolute path on this origin.
    if (!raw.startsWith('/')) return DEFAULT_AUTH_REDIRECT;
    // Reject scheme-relative (`//host`) and backslash/whitespace smugglers.
    if (raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\\')) return DEFAULT_AUTH_REDIRECT;
    for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        // Any control character, space, or DEL is not valid in a safe path.
        if (code <= 0x20 || code === 0x7f) return DEFAULT_AUTH_REDIRECT;
    }
    // Strip query/hash before the auth-route check so ?redirect=/login is safe.
    const pathOnly = raw.split(/[?#]/)[0];
    if (isAuthRoutePath(pathOnly)) return DEFAULT_AUTH_REDIRECT;
    return raw;
}

/**
 * Read the intended destination from a location search string. Used by the
 * auth pages so a redirect survives login/signup/verification.
 */
export function readRedirectParam(search: string): string {
    if (typeof search !== 'string' || search.length === 0) return DEFAULT_AUTH_REDIRECT;
    try {
        const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('redirect');
        return safeRedirectTarget(value);
    } catch {
        return DEFAULT_AUTH_REDIRECT;
    }
}

/**
 * SPA navigation. No-op when already on `path` (avoids redundant renders) and
 * never throws in non-browser environments.
 */
export function navigate(path: string): void {
    if (typeof window === 'undefined') return;
    const target = typeof path === 'string' && path.startsWith('/') ? path : DEFAULT_AUTH_REDIRECT;
    try {
        if (window.location.pathname === target) return;
        window.history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.scrollTo(0, 0);
    } catch {
        // History API unavailable — fall back to a hard navigation.
        try { window.location.href = target; } catch { /* ignore */ }
    }
}
