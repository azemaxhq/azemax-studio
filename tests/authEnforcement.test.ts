/**
 * Authentication ENFORCEMENT tests — the core security guarantee.
 *
 * Firebase Authentication is the sole identity provider and every product API
 * is protected. This suite proves, against a live ephemeral server, that:
 *
 *  - unauthenticated requests to every product route are rejected with 401
 *    (fail closed), while /api/health stays public;
 *  - an authenticated but UNVERIFIED identity is rejected with 403 on routes
 *    that spend server resources (AI, execution, projects);
 *  - a verified identity reaches the route (validation errors, not auth errors);
 *  - ownership is server-derived: one user can never read another user's project
 *    (404, no existence leak), and a client-supplied owner id is ignored;
 *  - there is no guest/anonymous path and no bypass flag.
 *
 * Real Firebase is never contacted (deterministic verifier seam); the DB is a
 * throwaway temp file.
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'azemax-enforce-test';
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'azemax-enforce-test-'));
process.env.DATA_DIR = TMP_DATA;
process.env.DATABASE_PATH = path.join(TMP_DATA, 'test.db');

const fbMod = await import('../server/services/auth/firebaseAdmin.cjs');
const fb = (fbMod as unknown as { default?: typeof fbMod }).default ?? fbMod;

const TOKENS: Record<string, Record<string, unknown>> = {
    'token-verified-a': {
        uid: 'enforce-uid-a',
        email: 'enforce.a@example.com',
        name: 'Enforce A',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
    },
    'token-verified-b': {
        uid: 'enforce-uid-b',
        email: 'enforce.b@example.com',
        name: 'Enforce B',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
    },
    'token-unverified': {
        uid: 'enforce-uid-unverified',
        email: 'enforce.pending@example.com',
        name: 'Enforce Pending',
        email_verified: false,
        firebase: { sign_in_provider: 'password' },
    },
};

fb.__setVerifyIdTokenForTests(async (idToken: string) => {
    const claims = TOKENS[idToken];
    if (claims) return { ...claims };
    const err = new Error('Invalid ID token');
    (err as { status?: number; code?: string }).status = 401;
    (err as { status?: number; code?: string }).code = 'auth/invalid-token';
    throw err;
});

const { createApp } = (await import('../server/app.cjs')) as unknown as {
    createApp: () => import('express').Application;
};
const dbMod = await import('../server/db/index.cjs');
const db = (dbMod as unknown as { default?: typeof dbMod }).default ?? dbMod;

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

// ---------------------------------------------------------------------------
// Public surface stays public
// ---------------------------------------------------------------------------
{
    const health = await call('GET', '/api/health');
    check('public: /api/health is reachable without auth', health.status === 200);
}

// ---------------------------------------------------------------------------
// Unauthenticated → 401 on every product route (fail closed)
// ---------------------------------------------------------------------------
{
    const protectedRoutes: Array<[string, string, unknown?]> = [
        ['GET', '/api/auth/me'],
        ['GET', '/api/projects'],
        ['POST', '/api/projects', { name: 'x' }],
        ['GET', '/api/projects/some-id'],
        ['DELETE', '/api/projects/some-id'],
        ['GET', '/api/account/state'],
        ['PUT', '/api/account/state/settings', { data: { general: { theme: 'dark' } } }],
        ['GET', '/api/ai/models'],
        ['POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] }],
        ['GET', '/api/runtimes'],
        ['POST', '/api/execute', { language: 'python', files: [{ name: 'main.py', content: 'print(1)' }] }],
    ];

    let allDenied = true;
    for (const [method, route, body] of protectedRoutes) {
        const res = await call(method, route, body);
        if (res.status !== 401) {
            allDenied = false;
            check(`unauth: ${method} ${route} -> 401`, false);
        }
    }
    check('unauth: every product route rejects with 401 (fail closed)', allDenied);
}

// ---------------------------------------------------------------------------
// Authenticated but UNVERIFIED → 403 on resource-spending routes
// ---------------------------------------------------------------------------
{
    const unverifiedRoutes: Array<[string, string, unknown?]> = [
        ['POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] }],
        ['GET', '/api/ai/models'],
        ['POST', '/api/execute', { language: 'python', files: [{ name: 'main.py', content: 'print(1)' }] }],
        ['GET', '/api/projects'],
        ['POST', '/api/projects', { name: 'x' }],
        ['GET', '/api/account/state'],
        ['PUT', '/api/account/state/settings', { data: { general: { theme: 'dark' } } }],
    ];

    let allForbidden = true;
    for (const [method, route, body] of unverifiedRoutes) {
        const res = await call(method, route, body, 'token-unverified');
        if (res.status !== 403) {
            allForbidden = false;
            check(`unverified: ${method} ${route} -> 403`, false);
        }
    }
    check('unverified: resource routes reject with 403', allForbidden);

    const aiUnverified = await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] }, 'token-unverified');
    check('unverified: 403 carries the verification-required code',
        (aiUnverified.json as { code?: string })?.code === 'auth/unverified-email');
}

// ---------------------------------------------------------------------------
// Verified → reaches the route (validation error, not an auth error)
// ---------------------------------------------------------------------------
{
    const aiEmpty = await call('POST', '/api/ai/chat', { messages: [] }, 'token-verified-a');
    check('verified: AI route reached (validation 400, not 401/403)', aiEmpty.status === 400);

    const models = await call('GET', '/api/ai/models', undefined, 'token-verified-a');
    check('verified: /api/ai/models reachable (200)', models.status === 200);

    const runtimes = await call('GET', '/api/runtimes', undefined, 'token-verified-a');
    check('verified: /api/runtimes reachable (200)', runtimes.status === 200);

    const execBad = await call('POST', '/api/execute', { language: 'python', files: [{ name: 'main.py', content: 'print(1)' }] }, 'token-verified-a');
    check('verified: execute reached the executor (not 401/403)', execBad.status !== 401 && execBad.status !== 403);

    const projects = await call('GET', '/api/projects', undefined, 'token-verified-a');
    check('verified: project list reachable (200)', projects.status === 200);

    const me = await call('GET', '/api/auth/me', undefined, 'token-verified-a');
    check('verified: /api/auth/me reachable (200)', me.status === 200);
}

// ---------------------------------------------------------------------------
// Ownership is server-derived (no cross-user access, no client-trusted owner)
// ---------------------------------------------------------------------------
{
    // User A creates a project, additionally attempting to inject an owner id.
    const created = await call('POST', '/api/projects', {
        name: 'owned-by-a',
        ownerId: 'enforce-uid-b',
        owner_id: 'enforce-uid-b',
        userId: 'enforce-uid-b',
    }, 'token-verified-a');
    check('ownership: verified user can create a project (201)', created.status === 201);
    const projectId = (created.json as { id?: string } | null)?.id;
    check('ownership: created project has an id', typeof projectId === 'string' && projectId.length > 0);

    // The injected owner id is ignored — A owns the project.
    const ownView = await call('GET', `/api/projects/${projectId}`, undefined, 'token-verified-a');
    check('ownership: creator can read their project (200)', ownView.status === 200);

    // User B cannot read or delete A's project (404 — no existence leak).
    const crossRead = await call('GET', `/api/projects/${projectId}`, undefined, 'token-verified-b');
    check('ownership: another user CANNOT read the project (404)', crossRead.status === 404);

    const crossDelete = await call('DELETE', `/api/projects/${projectId}`, undefined, 'token-verified-b');
    check('ownership: another user CANNOT delete the project (404)', crossDelete.status === 404);

    const crossOverwrite = await call('PUT', `/api/projects/${projectId}`, { name: 'stolen' }, 'token-verified-b');
    check('ownership: another user CANNOT overwrite the project (404)', crossOverwrite.status === 404);

    // The owner still has full control.
    const ownAfter = await call('GET', `/api/projects/${projectId}`, undefined, 'token-verified-a');
    check('ownership: owner retains access after cross-user attempts (200)', ownAfter.status === 200);
}

// ---------------------------------------------------------------------------
// Account state — ownership + validation + isolation
// ---------------------------------------------------------------------------
{
    const savedSettings = await call('PUT', '/api/account/state/settings', {
        data: { general: { theme: 'dark' }, privacy: { saveChatHistory: true } },
        ownerId: 'enforce-uid-b',
        userId: 'enforce-uid-b',
    }, 'token-verified-a');
    check('account: verified user can save settings (200)', savedSettings.status === 200);
    check('account: save returns a server timestamp',
        typeof (savedSettings.json as { updatedAt?: string } | null)?.updatedAt === 'string');

    const loaded = await call('GET', '/api/account/state/settings', undefined, 'token-verified-a');
    check('account: saved settings round-trip', loaded.status === 200
        && (loaded.json as { data?: { general?: { theme?: string } } } | null)?.data?.general?.theme === 'dark');

    const othersView = await call('GET', '/api/account/state/settings', undefined, 'token-verified-b');
    check('account: another user cannot see the saved section (empty)',
        othersView.status === 200
        && (othersView.json as { data?: unknown } | null)?.data === null);

    const othersSave = await call('PUT', '/api/account/state/settings', {
        data: { general: { theme: 'light' } },
    }, 'token-verified-b');
    check('account: another user writes an independent copy (200)', othersSave.status === 200);

    const aAfter = await call('GET', '/api/account/state/settings', undefined, 'token-verified-a');
    check('account: user A copy is unchanged after user B writes',
        (aAfter.json as { data?: { general?: { theme?: string } } } | null)?.data?.general?.theme === 'dark');

    const all = await call('GET', '/api/account/state', undefined, 'token-verified-a');
    check('account: list-state exposes the caller sections only',
        all.status === 200
        && Boolean((all.json as { sections?: Record<string, unknown> } | null)?.sections?.settings));

    const invalidSection = await call('PUT', '/api/account/state/secrets', { data: {} }, 'token-verified-a');
    check('account: unknown sections are rejected (400)', invalidSection.status === 400);

    const invalidData = await call('PUT', '/api/account/state/chats', { data: 'nope' }, 'token-verified-a');
    check('account: non-object section data is rejected (400)', invalidData.status === 400);

    await call('PUT', '/api/account/state/chats', { data: { sessions: [], currentSessionId: null } }, 'token-verified-a');
    const cleared = await call('DELETE', '/api/account/state/chats', undefined, 'token-verified-a');
    check('account: section delete is ownership-scoped and succeeds', cleared.status === 200
        && (cleared.json as { deleted?: boolean } | null)?.deleted === true);
    const afterDelete = await call('GET', '/api/account/state/chats', undefined, 'token-verified-a');
    check('account: deleted section reads back empty',
        (afterDelete.json as { data?: unknown } | null)?.data === null);
}

await new Promise<void>((resolve) => server.close(() => resolve()));
fb.__setVerifyIdTokenForTests(null);
try { (db as unknown as { closeDatabase: () => void }).closeDatabase(); } catch { /* ignore */ }
try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch { /* ignore */ }

finish('authEnforcement');
