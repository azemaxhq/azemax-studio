/**
 * Frontend authentication tests (pure logic, no DOM).
 *
 * Covers the pieces that decide access and validate input:
 *  - route classification for the auth surface (login/signup/…) 
 *  - open-redirect protection for post-login destinations
 *  - shared password policy + strength guidance
 *  - email normalization/validation
 *  - Firebase error-code -> user-message mapping (no account enumeration,
 *    no crash on unknown shapes)
 *
 * Run with: npx vitest run tests/authFlow.test.ts  (or `npm test`)
 */
import { check, finish } from './_harness';
import {
    AUTH_ROUTES,
    DEFAULT_AUTH_REDIRECT,
    isAuthRoutePath,
    readRedirectParam,
    safeRedirectTarget,
} from '../src/utils/appRouter';
import {
    PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    isValidEmail,
    normalizeEmail,
    passwordStrength,
    validatePassword,
} from '../src/core/auth/policy';
import { mapFirebaseError } from '../src/core/auth/firebase';

// ---------------------------------------------------------------------------
// Auth route classification
// ---------------------------------------------------------------------------
{
    check('routes: /login is an auth route', isAuthRoutePath('/login') === true);
    check('routes: /signup is an auth route', isAuthRoutePath('/signup') === true);
    check('routes: /forgot-password is an auth route', isAuthRoutePath('/forgot-password') === true);
    check('routes: /verify-email is an auth route', isAuthRoutePath('/verify-email') === true);
    check('routes: /auth/callback is an auth route', isAuthRoutePath('/auth/callback') === true);
    check('routes: trailing slash normalizes', isAuthRoutePath('/login/') === true);
    check('routes: /app is NOT an auth route', isAuthRoutePath('/app') === false);
    check('routes: / is NOT an auth route', isAuthRoutePath('/') === false);
    check('routes: /loginhelp is NOT an auth route (segment-exact)', isAuthRoutePath('/loginhelp') === false);
    check('routes: /signup/extra is NOT an auth route', isAuthRoutePath('/signup/extra') === false);
    check('routes: non-string is safe', isAuthRoutePath(undefined as unknown as string) === false);
    check('routes: catalog is non-empty', AUTH_ROUTES.length >= 5);
}

// ---------------------------------------------------------------------------
// Open-redirect protection (safeRedirectTarget)
// ---------------------------------------------------------------------------
{
    check('redirect: default is /app', DEFAULT_AUTH_REDIRECT === '/app');
    check('redirect: same-origin path allowed', safeRedirectTarget('/app/project/1') === '/app/project/1');
    check('redirect: query preserved on path', safeRedirectTarget('/app?tab=chat') === '/app?tab=chat');
    check('redirect: empty falls back', safeRedirectTarget('') === '/app');
    check('redirect: null falls back', safeRedirectTarget(null) === '/app');
    check('redirect: undefined falls back', safeRedirectTarget(undefined) === '/app');

    // Hostile / absolute targets must never be honored.
    check('redirect: absolute URL rejected', safeRedirectTarget('https://evil.example.com') === '/app');
    check('redirect: protocol-relative //evil rejected', safeRedirectTarget('//evil.example.com') === '/app');
    check('redirect: backslash-relative rejected', safeRedirectTarget('/\\evil.example.com') === '/app');
    check('redirect: internal backslash rejected', safeRedirectTarget('/app\\..\\evil') === '/app');
    check('redirect: control/space chars rejected', safeRedirectTarget('/app\nHost: evil') === '/app');
    check('redirect: overlong value rejected', safeRedirectTarget('/' + 'a'.repeat(600)) === '/app');
    check('redirect: javascript: scheme rejected', safeRedirectTarget('javascript:alert(1)') === '/app');

    // Never bounce back into an auth route (prevents login loops).
    check('redirect: /login target rejected', safeRedirectTarget('/login') === '/app');
    check('redirect: /verify-email target rejected', safeRedirectTarget('/verify-email') === '/app');
    check('redirect: /login?x=1 rejected', safeRedirectTarget('/login?x=1') === '/app');

    // Query-string parsing used by the auth pages.
    check('redirectParam: reads redirect', readRedirectParam('?redirect=%2Fapp%2Fp%2F9') === '/app/p/9');
    check('redirectParam: missing falls back', readRedirectParam('') === '/app');
    check('redirectParam: hostile falls back', readRedirectParam('?redirect=https%3A%2F%2Fevil.example.com') === '/app');
    check('redirectParam: no query falls back', readRedirectParam('?foo=bar') === '/app');
}

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------
{
    check('policy: min length is 10', PASSWORD_MIN_LENGTH === 10);
    check('policy: max length is 256', PASSWORD_MAX_LENGTH === 256);

    check('policy: empty password rejected', validatePassword('') !== null);
    check('policy: short password rejected', validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)) !== null);
    check('policy: boundary password accepted', validatePassword('a'.repeat(PASSWORD_MIN_LENGTH)) === null);
    check('policy: overlong password rejected', validatePassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)) !== null);
    check('policy: reject message mentions minimum', /at least 10/.test(validatePassword('short') || ''));

    const empty = passwordStrength('');
    check('strength: empty has zero score + empty label', empty.score === 0 && empty.label === '');

    const short = passwordStrength('Ab1!');
    check('strength: below-minimum is Weak', short.score === 1 && short.label === 'Weak');

    const long = passwordStrength('CorrectHorseBatteryStaple9!');
    check('strength: long mixed password is Strong', long.score === 4 && long.label === 'Strong');

    // Monotonic: a stronger password never scores lower than a weaker one.
    const weak = passwordStrength('aaaaaaaaaa');
    const good = passwordStrength('Aaaa1111!!bbbbbb');
    check('strength: stronger input scores >= weaker', good.score >= weak.score);
}

// ---------------------------------------------------------------------------
// Email normalization / validation
// ---------------------------------------------------------------------------
{
    check('email: trims + lowercases', normalizeEmail('  User@Example.COM ') === 'user@example.com');
    check('email: null -> empty', normalizeEmail(null) === '');
    check('email: valid address', isValidEmail('dev@azemax.dev') === true);
    check('email: uppercase valid after normalize', isValidEmail(' DEV@AZEMAX.DEV ') === true);
    check('email: missing @ rejected', isValidEmail('dev.azemax.dev') === false);
    check('email: missing domain dot rejected', isValidEmail('dev@azemax') === false);
    check('email: spaces rejected', isValidEmail('dev @azemax.dev') === false);
    check('email: empty rejected', isValidEmail('') === false);
}

// ---------------------------------------------------------------------------
// Firebase error mapping (user-facing, no leakage, no crash)
// ---------------------------------------------------------------------------
{
    check('fb: user-not-found -> generic sign-up hint',
        /sign up/i.test(mapFirebaseError({ code: 'auth/user-not-found' })));
    // Incorrect password and unknown user are surfaced as the SAME generic
    // message class (no account enumeration via text).
    const wrongPw = mapFirebaseError({ code: 'auth/wrong-password' });
    const invalid = mapFirebaseError({ code: 'auth/invalid-credential' });
    check('fb: wrong-password does not claim the account exists', !/no account/i.test(wrongPw));
    check('fb: invalid-credential generic', /invalid email or password/i.test(invalid));
    check('fb: email-in-use is actionable',
        /already exists/i.test(mapFirebaseError({ code: 'auth/email-already-in-use' })));
    check('fb: weak password guidance',
        /at least/i.test(mapFirebaseError({ code: 'auth/weak-password' })));
    check('fb: popup closed -> cancelled',
        /cancel/i.test(mapFirebaseError({ code: 'auth/popup-closed-by-user' })));
    check('fb: popup blocked guidance',
        /popup/i.test(mapFirebaseError({ code: 'auth/popup-blocked' })));
    check('fb: network failure guidance',
        /network/i.test(mapFirebaseError({ code: 'auth/network-request-failed' })));
    check('fb: too-many-requests guidance',
        /many failed attempts|try again later/i.test(mapFirebaseError({ code: 'auth/too-many-requests' })));
    check('fb: weak password references the real minimum',
        /at least 10/i.test(mapFirebaseError({ code: 'auth/weak-password' })));
    check('fb: different-credential does not silently merge',
        /different sign-in method/i.test(mapFirebaseError({ code: 'auth/account-exists-with-different-credential' })));
    check('fb: cancelled popup request -> cancelled',
        /cancel/i.test(mapFirebaseError({ code: 'auth/cancelled-popup-request' })));
    check('fb: unauthorized continue uri is actionable',
        /authorized domains/i.test(mapFirebaseError({ code: 'auth/unauthorized-continue-uri' })));

    // Never crashes / never fabricates success on unknown shapes.
    check('fb: null safe', typeof mapFirebaseError(null) === 'string');
    check('fb: string safe', typeof mapFirebaseError('boom') === 'string');
    check('fb: unknown code falls back to message',
        mapFirebaseError({ code: 'auth/whatever', message: 'Custom failure' }) === 'Custom failure');
}

finish('authFlow');
