/**
 * Tests for the beta auth transport hardening:
 *  - sessionToken storage fallback (memory when localStorage unavailable)
 *  - authHeaders / withSessionToken credential attachment
 *  - authFailureMessage classification (network vs HTML-misconfig vs API errors)
 *
 * Run with: npx tsx tests/authTransport.test.ts  (or `npm test` via vitest)
 */
import { check, finish } from './_harness';
import {
    getSessionToken,
    setSessionToken,
    clearSessionToken,
    authHeaders,
    withSessionToken,
    authFailureMessage,
} from '../src/utils/sessionToken';

// --- Token storage (node has no localStorage: memory fallback path) ---
{
    clearSessionToken();
    check('token starts empty', getSessionToken() === null);

    setSessionToken('tok_abc123');
    check('token round-trips via memory fallback', getSessionToken() === 'tok_abc123');

    check('authHeaders carries Bearer token', authHeaders().Authorization === 'Bearer tok_abc123');

    check(
        'withSessionToken appends ?token=',
        withSessionToken('wss://api.example.com') === 'wss://api.example.com?token=tok_abc123',
    );
    check(
        'withSessionToken appends &token= when query exists',
        withSessionToken('wss://api.example.com/?x=1') === 'wss://api.example.com/?x=1&token=tok_abc123',
    );

    clearSessionToken();
    check('token cleared', getSessionToken() === null);
    check('authHeaders empty without token', Object.keys(authHeaders()).length === 0);
    check(
        'withSessionToken is identity without token',
        withSessionToken('wss://api.example.com') === 'wss://api.example.com',
    );

    setSessionToken(null);
    check('setSessionToken(null) clears', getSessionToken() === null);
    setSessionToken(undefined);
    check('setSessionToken(undefined) clears', getSessionToken() === null);
    setSessionToken('');
    check('setSessionToken(empty) clears', getSessionToken() === null);
}

// --- Failure classification ---
{
    const net = authFailureMessage({ networkError: true });
    check('network error mentions backend/CORS', /Cannot reach the API server/.test(net) && /CORS_ORIGIN/.test(net));

    const html = authFailureMessage({
        contentType: 'text/html; charset=utf-8',
        status: 200,
        apiBase: '/api',
    });
    check(
        'HTML body is diagnosed as misconfiguration',
        /API misconfigured/.test(html) && /VITE_API_URL/.test(html),
    );

    check('401 maps to invalid credentials', authFailureMessage({ status: 401 }) === 'Invalid email or password.');
    check(
        '409 maps to existing-account hint',
        /already exists/.test(authFailureMessage({ status: 409 })),
    );
    check('429 maps to rate-limit hint', /Too many attempts/.test(authFailureMessage({ status: 429 })));

    check(
        'other API errors surface server message',
        authFailureMessage({ status: 400, bodyError: 'Password must be at least 10 characters' }) ===
            'Password must be at least 10 characters',
    );
    check(
        'unknown status without body falls back to HTTP code',
        authFailureMessage({ status: 500, bodyError: null }) === 'Request failed (HTTP 500). Try again.',
    );
}

finish('authTransport');
