/**
 * Tests for the Firebase ID-token transport:
 *  - in-memory token cache (no localStorage/cookie persistence)
 *  - authHeaders / withAuthToken credential attachment
 *  - authFailureMessage classification (network vs HTML-misconfig vs API errors)
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import {
    getIdToken,
    setIdToken,
    clearIdToken,
    authHeaders,
    withAuthToken,
    authFailureMessage,
} from '../src/utils/authToken';

// --- In-memory credential cache ---
{
    clearIdToken();
    check('token starts empty', getIdToken() === null);

    setIdToken('tok_abc123');
    check('token round-trips via memory cache', getIdToken() === 'tok_abc123');

    check('authHeaders carries Bearer token', authHeaders().Authorization === 'Bearer tok_abc123');

    check(
        'withAuthToken appends ?token=',
        withAuthToken('wss://api.example.com') === 'wss://api.example.com?token=tok_abc123',
    );
    check(
        'withAuthToken appends &token= when query exists',
        withAuthToken('wss://api.example.com/?x=1') === 'wss://api.example.com/?x=1&token=tok_abc123',
    );

    clearIdToken();
    check('token cleared', getIdToken() === null);
    check('authHeaders empty without token', Object.keys(authHeaders()).length === 0);
    check(
        'withAuthToken is identity without token',
        withAuthToken('wss://api.example.com') === 'wss://api.example.com',
    );

    setIdToken(null);
    check('setIdToken(null) clears', getIdToken() === null);
    setIdToken(undefined);
    check('setIdToken(undefined) clears', getIdToken() === null);
    setIdToken('');
    check('setIdToken(empty) clears', getIdToken() === null);
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

    check(
        '401 maps to session-expired',
        authFailureMessage({ status: 401 }) === 'Your session has expired. Please sign in again.',
    );
    check(
        '409 maps to existing-account hint',
        /already exists/.test(authFailureMessage({ status: 409 })),
    );
    check('429 maps to rate-limit hint', /Too many attempts/.test(authFailureMessage({ status: 429 })));

    check(
        'other API errors surface server message',
        authFailureMessage({ status: 400, bodyError: 'Bad request detail' }) === 'Bad request detail',
    );
    check(
        'unknown status without body falls back to HTTP code',
        authFailureMessage({ status: 500, bodyError: null }) === 'Request failed (HTTP 500). Try again.',
    );
}

finish('authTransport');
