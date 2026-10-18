/**
 * Tests for authentication routing, open redirect prevention,
 * and destination validation.
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import {
    isAuthRoutePath,
    safeRedirectTarget,
    readRedirectParam,
    AUTH_ROUTES,
    DEFAULT_AUTH_REDIRECT,
} from '../src/utils/appRouter';

// --- Auth route matching ---
{
    check('identifies /login', isAuthRoutePath('/login'));
    check('identifies /signup', isAuthRoutePath('/signup'));
    check('identifies /forgot-password', isAuthRoutePath('/forgot-password'));
    check('identifies /verify-email', isAuthRoutePath('/verify-email'));
    check('identifies /auth/callback', isAuthRoutePath('/auth/callback'));

    check('handles trailing slash on /login/', isAuthRoutePath('/login/'));
    check('handles trailing slash on /signup/', isAuthRoutePath('/signup/'));

    check('rejects /app as auth route', !isAuthRoutePath('/app'));
    check('rejects / as auth route', !isAuthRoutePath('/'));
    check('rejects random subpath /login-extra', !isAuthRoutePath('/login-extra'));
    check('rejects empty string', !isAuthRoutePath(''));

    // The catalog is the single source of truth for the auth surface.
    check('catalog lists the core auth routes', AUTH_ROUTES.length >= 5 && AUTH_ROUTES.includes('/login') && AUTH_ROUTES.includes('/signup'));
}

// --- Open redirect prevention (safeRedirectTarget) ---
{
    check('allows valid relative path /app', safeRedirectTarget('/app') === '/app');
    check('allows valid subpath /app/workspace', safeRedirectTarget('/app/workspace') === '/app/workspace');
    check('allows query string on safe path', safeRedirectTarget('/app?tab=terminal') === '/app?tab=terminal');

    // Attacks & open redirect vectors:
    check('rejects absolute http URL', safeRedirectTarget('http://attacker.com') === DEFAULT_AUTH_REDIRECT);
    check('rejects absolute https URL', safeRedirectTarget('https://evil.org/steal') === DEFAULT_AUTH_REDIRECT);
    check('rejects scheme-relative URL //evil.com', safeRedirectTarget('//evil.com') === DEFAULT_AUTH_REDIRECT);
    check('rejects scheme-relative with backslash /\\evil.com', safeRedirectTarget('/\\evil.com') === DEFAULT_AUTH_REDIRECT);
    check('rejects backslash smuggling /evil\\test', safeRedirectTarget('/evil\\test') === DEFAULT_AUTH_REDIRECT);
    check('rejects whitespace / control characters', safeRedirectTarget('/app\n/evil') === DEFAULT_AUTH_REDIRECT);
    check('rejects empty input', safeRedirectTarget('') === DEFAULT_AUTH_REDIRECT);
    check('rejects null input', safeRedirectTarget(null) === DEFAULT_AUTH_REDIRECT);
    check('rejects undefined input', safeRedirectTarget(undefined) === DEFAULT_AUTH_REDIRECT);

    // Prevent redirect loops to auth pages
    check('redirect to /login falls back to DEFAULT_AUTH_REDIRECT', safeRedirectTarget('/login') === DEFAULT_AUTH_REDIRECT);
    check('redirect to /signup falls back to DEFAULT_AUTH_REDIRECT', safeRedirectTarget('/signup') === DEFAULT_AUTH_REDIRECT);
    check('redirect to /forgot-password falls back to DEFAULT_AUTH_REDIRECT', safeRedirectTarget('/forgot-password') === DEFAULT_AUTH_REDIRECT);
}

// --- Query param extraction (readRedirectParam) ---
{
    check('reads ?redirect=/app/projects', readRedirectParam('?redirect=/app/projects') === '/app/projects');
    check('reads redirect without leading ?', readRedirectParam('redirect=/app/custom') === '/app/custom');
    check('neutralizes malicious query param', readRedirectParam('?redirect=https://evil.com') === DEFAULT_AUTH_REDIRECT);
    check('handles empty search', readRedirectParam('') === DEFAULT_AUTH_REDIRECT);
}

finish('authRouter');
