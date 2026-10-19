/**
 * Tests for API client URL construction and base URL validation:
 *  - API_BASE is correctly derived from VITE_API_URL
 *  - Production builds require VITE_API_URL ending in /api
 *  - URL joining never duplicates or omits path segments
 *  - Runtime validation catches misconfiguration
 *
 * Run with: npx tsx tests/apiClient.test.ts  (or `npm test` via vitest)
 */
import { check, finish } from './_harness';

// Test URL joining logic (extracted from apiFetch)
function joinUrl(base: string, path: string): string {
    return `${base}${path}`;
}

const testCases = [
    // { description, base, path, expected }
    { desc: 'absolute base with /api + path', base: 'https://api.example.com/api', path: '/ai/chat', expected: 'https://api.example.com/api/ai/chat' },
    { desc: 'absolute base with /api/ (trailing slash trimmed) + path', base: 'https://api.example.com/api/', path: '/ai/chat', expected: 'https://api.example.com/api/ai/chat' },
    { desc: 'relative base /api + path', base: '/api', path: '/ai/chat', expected: '/api/ai/chat' },
    { desc: 'relative base /api/ (trailing slash trimmed) + path', base: '/api/', path: '/ai/chat', expected: '/api/ai/chat' },
    { desc: 'account state path', base: 'https://api.example.com/api', path: '/account/state/settings', expected: 'https://api.example.com/api/account/state/settings' },
    { desc: 'projects path', base: 'https://api.example.com/api', path: '/projects', expected: 'https://api.example.com/api/projects' },
    { desc: 'execute path', base: 'https://api.example.com/api', path: '/execute', expected: 'https://api.example.com/api/execute' },
    { desc: 'runtimes path', base: 'https://api.example.com/api', path: '/runtimes', expected: 'https://api.example.com/api/runtimes' },
    { desc: 'health path', base: 'https://api.example.com/api', path: '/health', expected: 'https://api.example.com/api/health' },
];

for (const tc of testCases) {
    const result = joinUrl(tc.base.replace(/\/$/, ''), tc.path);
    check(tc.desc, result === tc.expected, { expected: tc.expected, actual: result });
}

// Test that production validation regex works
const prodUrlRegex = /^https?:\/\/.*\/api$/i;
const validUrls = [
    'https://azemax-backend-vzox.onrender.com/api',
    'http://localhost:3001/api',
    'https://api.example.com/api',
    'https://my-backend.render.com/api',
];
const invalidUrls = [
    'https://azemax-backend-vzox.onrender.com',      // missing /api
    'https://azemax-backend-vzox.onrender.com/',     // missing /api
    'https://azemax-backend-vzox.onrender.com/api/', // trailing slash (would be trimmed)
    '/api',                                           // relative, not absolute
    '',                                               // empty
    'not-a-url',                                      // invalid
    'https://example.com/apiv2',                      // wrong suffix
];

for (const url of validUrls) {
    check(`prod validation: accepts "${url}"`, prodUrlRegex.test(url));
}
for (const url of invalidUrls) {
    check(`prod validation: rejects "${url}"`, !prodUrlRegex.test(url));
}

// Test that API_BASE construction logic matches expectation
function constructApiBase(viteApiUrl: string | undefined): string {
    return (viteApiUrl || '/api').replace(/\/$/, '');
}

check('API_BASE: VITE_API_URL with /api -> keeps /api', constructApiBase('https://api.example.com/api') === 'https://api.example.com/api');
check('API_BASE: VITE_API_URL with /api/ -> trims slash', constructApiBase('https://api.example.com/api/') === 'https://api.example.com/api');
check('API_BASE: VITE_API_URL bare origin -> keeps bare', constructApiBase('https://api.example.com') === 'https://api.example.com');
check('API_BASE: undefined -> fallback /api', constructApiBase(undefined) === '/api');
check('API_BASE: empty string -> fallback /api', constructApiBase('') === '/api');

finish('apiClient');