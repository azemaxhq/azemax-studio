/**
 * Public-beta (anonymous access) regression tests.
 *
 * Covers the Phase-6 contract without touching real provider APIs or the real
 * database (server tests use a temp DATA_DIR; AI/execution tests stop at the
 * validation layer with bodies that can never reach a provider):
 *
 *  FRONTEND (pure helpers, no DOM):
 *  - beta is OPEN by default; /app routing never redirects to login
 *  - anonymous storage namespace is disjoint from every real account and
 *    migrates legacy global keys (the shape e2e seeds) exactly once
 *  - guest banner dismiss round-trips
 *
 *  BACKEND:
 *  - requireAuth still 401s anonymous traffic (projects/admin stay protected)
 *  - requireAuthOrPublicBeta mints server-side IP-bound `anon:` identities
 *    (never trusts client-supplied ids) and passes real sessions through
 *  - anonymous ids cannot collide with real user ids
 *  - guest daily quotas are tighter than authenticated quotas
 *  - LIVE (ephemeral port, temp DB): /api/health public; /api/projects and
 *    /api/auth/me 401 anonymous; AI/execute validation (400/413) applies to
 *    anonymous instead of 401; signup→projects→cross-user-404 flow intact;
 *    requireAdmin 403s non-admins.
 *
 * Run with: npx vitest run tests/publicBeta.test.ts  (or `npm test`)
 */
import { check, finish, makeLocalStorage } from './_harness';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Environment: BEFORE any app import (server config is evaluated at import).
// dotenv never overrides pre-set vars, so these win over the repo .env —
// critically DISABLE_AUTH=false (repo .env sets true for local dev).
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.DISABLE_AUTH = 'false';
process.env.PUBLIC_BETA = 'true';
process.env.AUTH_SECRET = 'test-secret-0123456789abcdef-test-secret';
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'azemax-beta-test-'));
process.env.DATA_DIR = TMP_DATA;
process.env.DATABASE_PATH = path.join(TMP_DATA, 'test.db');

// Frontend build-time flags before importing src modules.
(import.meta as unknown as { env: Record<string, unknown> }).env = {
    VITE_PUBLIC_BETA: 'true',
    VITE_API_URL: '/api',
    VITE_DISABLE_AUTH: 'false',
    VITE_USE_BACKEND_AI: 'true',
    DEV: false,
};

const storage = makeLocalStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

// ---------------------------------------------------------------------------
// Frontend: betaAccess + userStorage
// ---------------------------------------------------------------------------
const beta = await import('../src/utils/betaAccess');
const userStorage = await import('../src/utils/userStorage');

{
    check('beta: PUBLIC_BETA defaults open', beta.PUBLIC_BETA === true);
    check('beta: anon id is beta-anon', beta.ANON_USER_ID === 'beta-anon');
    check('beta: ANON_USER shape', beta.ANON_USER.id === 'beta-anon' && beta.ANON_USER.isAnonymous === true);
    check('beta: isAnonUserId(beta-anon)', beta.isAnonUserId('beta-anon') === true);
    check('beta: real uuid is not anon', beta.isAnonUserId('7f3c2a91-0000-4000-8000-abcdef123456') === false);
    check('beta: local-dev bypass id is not anon', beta.isAnonUserId('local-dev') === false);
    check('beta: null/undefined are not anon', beta.isAnonUserId(null) === false && beta.isAnonUserId(undefined) === false);
}

{
    check('route: /app is workspace', beta.isAppRoutePath('/app') === true);
    check('route: /app/ is workspace', beta.isAppRoutePath('/app/') === true);
    check('route: /app/file is workspace', beta.isAppRoutePath('/app/notes.md') === true);
    check('route: / is landing', beta.isAppRoutePath('/') === false);
    check('route: /login is landing (no login route takes over)', beta.isAppRoutePath('/login') === false);
    check('route: /application is NOT an app route (exact segment)', beta.isAppRoutePath('/application') === false);
    check('route: /ap is landing', beta.isAppRoutePath('/ap') === false);
}

{
    storage.clear();
    check('banner: visible by default', beta.isBetaBannerDismissed() === false);
    beta.dismissBetaBanner();
    check('banner: dismissed persists', beta.isBetaBannerDismissed() === true);
    storage.clear();
}

{
    // Anonymous namespace isolation + legacy global migration (e2e seed shape).
    // Legacy behavior: the FIRST namespaced read copies the pre-existing
    // global value once (existing users lose no data). Isolation guarantee:
    // later anonymous WRITES never reach any real account's namespace.
    storage.clear();
    userStorage.setCurrentUserId(null);
    storage.setItem('azemax-file-tree', JSON.stringify([{ id: 'v1-global' }]));
    userStorage.setCurrentUserId('beta-anon');
    const anonKey = userStorage.namespacedKey('azemax-file-tree');
    check('storage: anon key is namespaced', anonKey === 'azemax:u:beta-anon:azemax-file-tree');
    check('storage: anon read migrates legacy global value', userStorage.nsGetItem('azemax-file-tree') === JSON.stringify([{ id: 'v1-global' }]));
    userStorage.nsSetItem('azemax-file-tree', JSON.stringify([{ id: 'v2-anon-edit' }]));
    userStorage.setCurrentUserId('7f3c2a91-0000-4000-8000-abcdef123456');
    const realKey = userStorage.namespacedKey('azemax-file-tree');
    check('storage: real-user key differs from anon key', realKey !== anonKey);
    check('storage: real user never sees anon edits (no cross-account leak)',
        userStorage.nsGetItem('azemax-file-tree') !== JSON.stringify([{ id: 'v2-anon-edit' }]));
    userStorage.setCurrentUserId('beta-anon');
    check('storage: anon data stable across refresh (same namespace)',
        userStorage.nsGetItem('azemax-file-tree') === JSON.stringify([{ id: 'v2-anon-edit' }]));
    userStorage.setCurrentUserId(null);
    storage.clear();
}

// ---------------------------------------------------------------------------
// Backend: middleware units
// ---------------------------------------------------------------------------
const authMod = await import('../server/middleware/auth.cjs');
const auth = (authMod as unknown as { default?: Record<string, never> }).default ?? authMod;
const cfgMod = await import('../server/config/index.cjs');
const cfg = (cfgMod as unknown as { default?: Record<string, never> }).default ?? cfgMod;

{
    check('server: PUBLIC_BETA enabled in beta mode', cfg.PUBLIC_BETA === true);
    check('server: guest AI quota tighter than authed quota',
        cfg.LIMITS.AI_ANON_REQUESTS_PER_DAY > 0 && cfg.LIMITS.AI_ANON_REQUESTS_PER_DAY < cfg.LIMITS.AI_REQUESTS_PER_DAY);
    check('server: guest exec quota tighter than authed quota',
        cfg.LIMITS.EXEC_ANON_REQUESTS_PER_DAY > 0 && cfg.LIMITS.EXEC_ANON_REQUESTS_PER_DAY < cfg.LIMITS.EXEC_REQUESTS_PER_DAY);
}

function mockRes() {
    const res = {
        statusCode: 0,
        body: null as unknown,
        status(code: number) { res.statusCode = code; return res; },
        json(payload: unknown) { res.body = payload; return res; },
    };
    return res;
}

{
    check('anon: isAnonymousId matches prefix', auth.isAnonymousId('anon:1.2.3.4') === true);
    check('anon: real uuid is not anonymous', auth.isAnonymousId('7f3c2a91-0000-4000-8000-abcdef123456') === false);
    check('anon: local-dev is not anonymous', auth.isAnonymousId('local-dev') === false);

    // Server-minted id derives from the connection IP; hostile chars stripped.
    const minted = auth.buildAnonymousUser({ ip: '1.2.3.4', socket: { remoteAddress: '9.9.9.9' } });
    check('anon: minted id is IP-bound', minted.id === 'anon:1.2.3.4');
    const hostile = auth.buildAnonymousUser({ ip: 'a;b/c$d(../etc)', socket: null });
    check('anon: hostile IP chars sanitized', hostile.id.startsWith('anon:') && !/[;/$()\s]/.test(hostile.id));
    // A client-supplied userId/body id is never trusted.
    const untrusted = auth.buildAnonymousUser({ ip: '5.6.7.8', body: { userId: 'victim-uuid' }, user: { id: 'victim-uuid' } });
    check('anon: client-supplied id ignored', untrusted.id === 'anon:5.6.7.8');

    check('anon: request flagged only for anon ids',
        auth.isAnonymousRequest({ user: { id: 'anon:1.2.3.4' } }) === true &&
        auth.isAnonymousRequest({ user: { id: 'real-uuid' } }) === false &&
        auth.isAnonymousRequest({}) === false);
}

{
    // requireAuth stays a hard wall (projects/admin path).
    let nextCalled = false;
    const res = mockRes();
    auth.requireAuth({ user: null }, res, () => { nextCalled = true; });
    check('wall: requireAuth 401s anonymous', nextCalled === false && res.statusCode === 401);

    // requireAuthOrPublicBeta passes real sessions through untouched.
    nextCalled = false;
    const realReq = { user: { id: 'real-uuid', email: 'a@b.c' }, ip: '1.1.1.1' };
    auth.requireAuthOrPublicBeta(realReq, mockRes(), () => { nextCalled = true; });
    check('beta: real session passes through unmodified',
        nextCalled === true && realReq.user.id === 'real-uuid' && (realReq as { isAnonymous?: boolean }).isAnonymous !== true);

    // Anonymous visitors get a server-minted identity, never a 401.
    nextCalled = false;
    const anonReq = { user: null as null | { id: string }, ip: '2.3.4.5', socket: { remoteAddress: '2.3.4.5' } };
    auth.requireAuthOrPublicBeta(anonReq, mockRes(), () => { nextCalled = true; });
    check('beta: anonymous minted + flagged, not rejected',
        nextCalled === true && anonReq.user !== null && anonReq.user.id === 'anon:2.3.4.5' &&
        (anonReq as unknown as { isAnonymous: boolean }).isAnonymous === true);

    // Privileged endpoints stay protected: non-admin gets 403, anon gets 401.
    let adminNext = false;
    const adminRes = mockRes();
    auth.requireAdmin({ user: { id: 'u', email: 'user@example.com' } }, adminRes, () => { adminNext = true; });
    check('wall: requireAdmin 403s non-admin', adminNext === false && adminRes.statusCode === 403);
    adminNext = false;
    const anonAdminRes = mockRes();
    auth.requireAdmin({ user: null }, anonAdminRes, () => { adminNext = true; });
    check('wall: requireAdmin 401s anonymous', adminNext === false && anonAdminRes.statusCode === 401);
}

// ---------------------------------------------------------------------------
// Backend: live HTTP against an ephemeral port + temp DB
// ---------------------------------------------------------------------------
const { createApp } = (await import('../server/app.cjs')) as unknown as {
    createApp: () => import('express').Application;
};
const app = createApp();
const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const address = server.address();
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 3001}`;

async function call(method: string, urlPath: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${urlPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
}

{
    const health = await call('GET', '/api/health');
    check('live: /api/health public (200)', health.status === 200);

    const projects = await call('GET', '/api/projects');
    check('live: /api/projects 401 anonymous (private stays protected)', projects.status === 401);
    const projectsPost = await call('POST', '/api/projects', { name: 'x' });
    check('live: POST /api/projects 401 anonymous', projectsPost.status === 401);
    const projectsOne = await call('GET', '/api/projects/anything');
    check('live: GET /api/projects/:id 401 anonymous (gate, not 404)', projectsOne.status === 401);

    const me = await call('GET', '/api/auth/me');
    check('live: /api/auth/me 401 anonymous', me.status === 401);

    const runtimes = await call('GET', '/api/runtimes');
    check('live: /api/runtimes reachable anonymous (200)', runtimes.status === 200);

    // Validation applies to anonymous traffic (NOT a 401, NOT a provider call —
    // empty messages fail before any provider/model policy runs).
    const aiEmpty = await call('POST', '/api/ai/chat', { messages: [] });
    check('live: anon AI empty-messages rejected by validation (400, not 401)',
        aiEmpty.status === 400);
    const aiBad = await call('POST', '/api/ai/chat', { messages: [{ content: 42 }] });
    check('live: anon AI malformed message rejected (400)', aiBad.status === 400);

    // Oversized stdin fails at the size gate before any execution.
    const big = await call('POST', '/api/execute', {
        language: 'python',
        files: [{ name: 'main.py', content: 'print(1)' }],
        stdin: 'x'.repeat(40 * 1024),
    });
    check('live: anon execute oversized stdin rejected (413, not 401)', big.status === 413);
}

{
    // Authenticated flows: signup → projects CRUD → cross-user isolation.
    const email1 = `beta1-${Date.now()}@example.com`;
    const s1 = await call('POST', '/api/auth/signup', { email: email1, password: '0123456789abcdef', displayName: 'Beta One' });
    check('live: signup works (201, login stays optional)', s1.status === 201);
    const token1 = (s1.json as { token?: string } | null)?.token;
    check('live: signup returns session token', typeof token1 === 'string' && token1.length > 0);

    const list1 = await call('GET', '/api/projects', undefined, token1);
    check('live: authed project list works (200)', list1.status === 200);

    const created = await call('POST', '/api/projects', { name: 'beta-proj' }, token1);
    check('live: authed project create works (201)', created.status === 201);
    const projId = (created.json as { id?: string } | null)?.id;
    check('live: created project has id', typeof projId === 'string' && projId.length > 0);

    const authedAiBad = await call('POST', '/api/ai/chat', { messages: [] }, token1);
    check('live: authed AI validation intact (400)', authedAiBad.status === 400);

    const email2 = `beta2-${Date.now()}@example.com`;
    const s2 = await call('POST', '/api/auth/signup', { email: email2, password: '0123456789abcdef', displayName: 'Beta Two' });
    const token2 = (s2.json as { token?: string } | null)?.token;
    const cross = await call('GET', `/api/projects/${projId}`, undefined, token2);
    check('live: second user cannot read first user project (404, not leak)', cross.status === 404);
    const own = await call('GET', `/api/projects/${projId}`, undefined, token1);
    check('live: owner can still read own project (200)', own.status === 200);
}

await new Promise<void>((resolve) => server.close(() => resolve()));
{
    const dbMod = await import('../server/db/index.cjs');
    const db = (dbMod as unknown as { default?: { closeDatabase?: () => void } }).default ?? dbMod;
    try { (db as unknown as { closeDatabase: () => void }).closeDatabase(); } catch { /* ignore */ }
}
try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch { /* ignore */ }

finish('publicBeta');
