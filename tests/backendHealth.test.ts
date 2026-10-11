/**
 * Tests for the background backend wake-up (Render cold-start tolerance):
 *  - health URL construction never duplicates the /api prefix
 *  - exactly one request per page load (single-flight + no retry)
 *  - success / non-2xx / network failure / timeout all settle without throwing
 *  - timeouts and failures stay silent (no error surfacing, no AI provider call)
 *  - the request is a bare GET: no auth headers, no body, no AI endpoints
 *
 * Run with: npx tsx tests/backendHealth.test.ts  (or `npm test` via vitest)
 */
import { check, finish } from './_harness';
import {
    BACKEND_HEALTH_TIMEOUT_MS,
    __resetBackendHealthForTests,
    buildHealthUrl,
    getBackendHealthSnapshot,
    getHealthUrl,
    wakeBackend,
} from '../src/utils/backendHealth';

// --- URL construction: never duplicate /api, always target liveness --------
{
    check("url: relative '/api' -> '/api/health'", buildHealthUrl('/api') === '/api/health');
    check(
        'url: absolute Render base keeps single /api',
        buildHealthUrl('https://azemax-api.onrender.com/api') === 'https://azemax-api.onrender.com/api/health',
    );
    check(
        'url: trailing slash trimmed, no double slash',
        buildHealthUrl('https://azemax-api.onrender.com/api/') === 'https://azemax-api.onrender.com/api/health',
    );
    check(
        'url: bare origin gains /api/health',
        buildHealthUrl('https://azemax-api.onrender.com') === 'https://azemax-api.onrender.com/api/health',
    );
    check('url: empty base falls back to /api/health', buildHealthUrl('') === '/api/health');
    check('url: never points at an AI endpoint', !buildHealthUrl('/api').includes('/ai/'));
    check('url: default timeout is bounded and reasonable', BACKEND_HEALTH_TIMEOUT_MS >= 5_000 && BACKEND_HEALTH_TIMEOUT_MS <= 60_000);
    check('url: configured URL targets liveness', getHealthUrl().endsWith('/api/health'));
}

// --- fetch stub plumbing ------------------------------------------------------
type FetchCall = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];
const installStub = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
    calls = [];
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown, init: unknown) => {
        calls.push({ url: String(url), init: (init || {}) as RequestInit });
        return impl(String(url), (init || {}) as RequestInit);
    };
};
const restoreFetch = () => {
    globalThis.fetch = realFetch;
};
const okResponse = () =>
    new Response(JSON.stringify({ status: 'ok', service: 'ai-code-editor-api' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

// --- success path -------------------------------------------------------------
{
    __resetBackendHealthForTests();
    installStub(async () => okResponse());
    let threw: unknown = null;
    let result = false;
    try {
        result = await wakeBackend({ timeoutMs: 2_000 });
    } catch (e) {
        threw = e;
    }
    check('wake: success resolves true without throwing', threw === null && result === true);
    check('wake: status becomes ready on success', getBackendHealthSnapshot() === 'ready');
    check('wake: exactly one request issued', calls.length === 1);
    check('wake: request targets the health endpoint', calls[0]?.url.endsWith('/api/health') === true);
    check('wake: request is a bare GET', calls[0]?.init.method === 'GET');
    check(
        'wake: no auth headers or secrets attached',
        (calls[0]?.init.headers as Record<string, string> | undefined) === undefined &&
            calls[0]?.init.body === undefined &&
            calls[0]?.init.credentials !== 'include',
    );
    check('wake: never calls an AI provider endpoint', !calls[0]?.url.includes('/ai/'));
}

// --- single-flight: concurrent callers share one request ----------------------
{
    __resetBackendHealthForTests();
    let release!: () => void;
    const gate = new Promise<Response>((resolve) => {
        release = () => resolve(okResponse());
    });
    installStub(async () => gate);
    const p1 = wakeBackend({ timeoutMs: 2_000 });
    const p2 = wakeBackend({ timeoutMs: 2_000 });
    const p3 = wakeBackend({ timeoutMs: 2_000 });
    check('wake: concurrent calls share the in-flight promise', p1 === p2 && p2 === p3);
    check('wake: status is connecting while in flight', getBackendHealthSnapshot() === 'connecting');
    release();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    check('wake: all joiners resolve true', r1 === true && r2 === true && r3 === true);
    check('wake: concurrent callers issued one request total', calls.length === 1);
}

// --- no retry after success: repeated initializations stay quiet --------------
{
    const before = calls.length;
    const again = await wakeBackend({ timeoutMs: 2_000 });
    check('wake: no second request after success', calls.length === before && again === true);
}

// --- non-2xx: silent failure, no throw, no retry -------------------------------
{
    __resetBackendHealthForTests();
    installStub(async () => new Response('booting', { status: 503 }));
    let threw: unknown = null;
    let result = true;
    try {
        result = await wakeBackend({ timeoutMs: 2_000 });
    } catch (e) {
        threw = e;
    }
    check('wake: HTTP 503 resolves false without throwing', threw === null && result === false);
    check('wake: non-2xx settles to unavailable (never an error UI)', getBackendHealthSnapshot() === 'unavailable');
    const before = calls.length;
    const again = await wakeBackend({ timeoutMs: 2_000 });
    check('wake: no retry after HTTP failure', calls.length === before && again === false);
}

// --- network failure: silent, no throw, no retry -------------------------------
{
    __resetBackendHealthForTests();
    installStub(async () => {
        throw new TypeError('Failed to fetch');
    });
    let threw: unknown = null;
    let result = true;
    try {
        result = await wakeBackend({ timeoutMs: 2_000 });
    } catch (e) {
        threw = e;
    }
    check('wake: network failure resolves false without throwing', threw === null && result === false);
    check('wake: network failure settles to unavailable', getBackendHealthSnapshot() === 'unavailable');
    const before = calls.length;
    const again = await wakeBackend({ timeoutMs: 2_000 });
    check('wake: no retry after network failure', calls.length === before && again === false);
}

// --- timeout: abort fires, cold start stays silent ------------------------------
{
    __resetBackendHealthForTests();
    installStub(
        (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
                // Hanging backend (cold Render instance): only settle via abort.
                const signal = init.signal as AbortSignal | undefined;
                const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
                if (signal?.aborted) {
                    onAbort();
                    return;
                }
                signal?.addEventListener('abort', onAbort, { once: true });
            }),
    );
    const started = Date.now();
    let threw: unknown = null;
    let result = true;
    try {
        result = await wakeBackend({ timeoutMs: 60 });
    } catch (e) {
        threw = e;
    }
    const elapsed = Date.now() - started;
    check('wake: timeout resolves false without throwing', threw === null && result === false);
    check('wake: abort fires near the configured timeout', elapsed < 5_000);
    check('wake: timeout settles to unavailable (no backend error shown)', getBackendHealthSnapshot() === 'unavailable');
    check('wake: timeout issued exactly one request', calls.length === 1);
    const before = calls.length;
    const again = await wakeBackend({ timeoutMs: 60 });
    check('wake: no retry after timeout', calls.length === before && again === false);
}

restoreFetch();
__resetBackendHealthForTests();

finish('backendHealth');
