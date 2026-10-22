/**
 * AI mode regression tests — Azemax Default vs Bring Your Own Key.
 *
 * These tests use MOCKED provider responses and FAKE credentials only. No
 * live provider is contacted and no real API key is used.
 *
 * The two modes are independent by contract:
 *   azemax-default → the existing backend serves the request (no key needed)
 *   byok           → the user's own provider is called with the user's key
 *
 * A failure in one mode must never silently switch to the other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendChatResult, streamChat } from '../src/core/ai/AIClient';
import { sessionStore, encryptedStore } from '../src/core/ai/credentialStore';
import { setSetting, getSetting } from '../src/settings/settingsStore';
import {
    getAIMode,
    setAIMode,
    isByokMode,
    getSelectedProviderId,
    resolveAIMode,
    resolveByokTarget,
} from '../src/core/ai/byokRuntime';
import { AI_ERROR_CODES } from '../src/core/ai/AIError';
import { fetchDefaultModels, pickDefaultModelId, clearDefaultModelCache } from '../src/core/ai/defaultModels';
import { runAgentController } from '../src/core/ai/agentController';
import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import {
    createFile as opCreateFile,
    ensureFolderPath,
} from '../src/core/filesystem/operations';
import { resolveResource } from '../src/core/filesystem/queries';
import { emitFileChange } from '../src/core/filesystem/fileChangeService';

const FAKE_KEY = 'sk-fake-mode-key-0000';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

class WS {
    tree: FileNode[] = [];
    getFileTree = () => this.tree;
    createFile = (path: string, content = '') => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) this.tree = ensureFolderPath(this.tree, dir).tree;
        const parent = dir ? resolveResource(this.tree, dir) : null;
        if (dir && !parent) return { error: { message: 'no parent' } };
        const r = opCreateFile(this.tree, { name, parentId: dir ? parent!.id : ROOT_NODE_ID, content });
        if (r.changed && !r.error) {
            this.tree = r.tree;
            if (r.node) emitFileChange({ kind: 'created', id: r.node.id, name: r.node.name });
        }
        return r.error ? { error: r.error } : { changed: true };
    };
    content = (p: string) => {
        const n = resolveResource(this.tree, p);
        return n && n.type === 'file' && typeof n.content === 'string' ? n.content : null;
    };
    bridge() {
        return {
            getFileTree: this.getFileTree,
            createFile: this.createFile,
            deleteNode: () => {},
            renameNode: () => {},
            updateFileContent: () => ({ changed: true }),
        } as never;
    };
}

/** Records outbound calls so a test can assert which path was taken. */
const recordingFetch = (
    responses: Array<{ status?: number; body?: unknown; sse?: string }>,
) => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let i = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
        const headers = (init as any)?.headers ?? {};
        const body = typeof (init as any)?.body === 'string' ? (init as any).body : '';
        calls.push({ url: String(url), headers, body });
        const spec = responses[Math.min(i++, responses.length - 1)] ?? {};
        const status = spec.status ?? 200;
        if (spec.sse !== undefined) {
            return {
                ok: status < 400,
                status,
                headers: { get: () => null },
                body: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode(spec.sse!));
                        c.close();
                    },
                }),
            };
        }
        if (status >= 400) {
            return {
                ok: false,
                status,
                headers: { get: () => null },
                json: async () => spec.body ?? { error: { message: 'failed' } },
                text: async () => JSON.stringify(spec.body ?? {}),
            };
        }
        const payload = spec.body ?? { content: 'ok' };
        return {
            ok: true,
            status,
            headers: { get: () => null },
            // The models endpoint returns a raw catalog; the chat endpoint
            // returns an OpenAI-style completion envelope.
            json: async () => (
                payload && typeof payload === 'object' && 'models' in (payload as object)
                    ? payload
                    : { choices: [{ message: payload }] }
            ),
        };
    }) as unknown as typeof fetch;
    return { calls };
};

const originalFetch = globalThis.fetch;

beforeEach(async () => {
    vi.clearAllMocks();
    await sessionStore.clear();
    clearDefaultModelCache();
    setSetting('ai.mode', 'azemax-default');
    setSetting('ai.activeProvider', '');
    setSetting('ai.defaultModel', '');
    setSetting('ai.allowServerFallback', false);
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    setSetting('ai.mode', 'azemax-default');
    setSetting('ai.activeProvider', '');
    setSetting('ai.defaultModel', '');
});

// ===========================================================================
// DEFAULT MODE
// ===========================================================================

describe('Azemax Default mode', () => {
    it('1. a user without BYOK credentials can use Azemax Default', async () => {
        // No credential at all.
        expect(await sessionStore.getAllCredentials()).toEqual([]);

        const { calls } = recordingFetch([{ body: { content: 'default answer' } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toBe('default answer');
        // The request went to the Azemax backend, not to a provider.
        expect(calls[0].url).not.toContain('api.openai.com');
        expect(calls[0].url).not.toContain('api.groq.com');
    });

    it('2. the existing default model list remains accessible from the backend', async () => {
        const { calls } = recordingFetch([
            {
                body: {
                    models: [
                        { id: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia', label: 'Nemotron 3 Super 120B (NVIDIA)', primary: true },
                        { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)' },
                    ],
                },
            },
        ]);

        const catalog = await fetchDefaultModels();
        expect(catalog.models).toHaveLength(2);
        expect(catalog.models[0].id).toBe('nvidia/nemotron-3-super-120b-a12b');
        expect(catalog.models[0].primary).toBe(true);
        expect(catalog.error).toBeUndefined();
        // The catalog comes from the EXISTING backend endpoint.
        expect(calls[0].url).toContain('/ai/models');
        expect(pickDefaultModelId(catalog)).toBe('nvidia/nemotron-3-super-120b-a12b');
    });

    it('3. a default-model request uses the current backend/server provider', async () => {
        const { calls } = recordingFetch([{ body: { content: 'server' } }]);
        await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        expect(calls[0].url).toContain('/ai/chat');
    });

    it('4. default streaming works', async () => {
        const sse = [
            'data: {"type":"token","content":"Hel"}',
            'data: {"type":"token","content":"lo"}',
            'data: {"type":"done","model":"m"}',
            'data: [DONE]',
            '',
        ].join('\n');
        recordingFetch([{ sse }]);

        const chunks: string[] = [];
        for await (const event of streamChat([{ role: 'user', content: 'hi' }], { task: 'chat' })) {
            if (event.type === 'delta') chunks.push(event.content);
        }
        expect(chunks.join('')).toBe('Hello');
    });

    it('5. default mode works with a completely empty credential store', async () => {
        await sessionStore.clear();
        await encryptedStore.clear().catch(() => undefined);
        expect(getAIMode()).toBe('azemax-default');
        expect(isByokMode()).toBe(false);
        // The default path does not touch the credential store at all.
        expect(await resolveByokTarget()).toBeNull();
    });

    it('6. default-mode errors are reported accurately', async () => {
        recordingFetch([{ status: 503, body: { error: { message: 'upstream down' } } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            // The backend's own verdict is surfaced, not a BYOK error.
            expect(result.error.code).toBe(AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED);
        }
    });

    it('17. a default-provider outage does not silently trigger BYOK', async () => {
        // A BYOK credential exists, but the mode is Azemax Default.
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: 'openai', name: 'OpenAI', apiKey: FAKE_KEY, model: 'gpt-4o', rememberOnDevice: false,
        });

        const { calls } = recordingFetch([{ status: 503, body: { error: { message: 'down' } } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        // The user's provider was never contacted.
        expect(calls.every((c) => !c.url.includes('api.openai.com'))).toBe(true);
        expect(calls.every((c) => !c.headers.Authorization)).toBe(true);
    });
});

// ===========================================================================
// MODE SELECTION
// ===========================================================================

describe('AI mode selection', () => {
    const storeKey = async (providerId = 'openai') => {
        await sessionStore.setCredentials({
            id: providerId as never,
            name: providerId,
            apiKey: FAKE_KEY,
            model: 'gpt-4o',
            rememberOnDevice: false,
        });
    };

    it('7. explicitly selecting Azemax Default bypasses BYOK', async () => {
        await storeKey();
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        setAIMode('azemax-default');

        const { calls } = recordingFetch([{ body: { content: 'default' } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(true);
        // The user's key was NOT used.
        expect(calls.every((c) => !c.headers.Authorization)).toBe(true);
        expect(calls.every((c) => !c.url.includes('api.openai.com'))).toBe(true);
    });

    it('8. explicitly selecting BYOK uses the configured provider', async () => {
        await storeKey();
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        setAIMode('byok');

        const { calls } = recordingFetch([{ body: { content: 'byok answer' } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(true);
        expect(calls[0].url).toContain('api.openai.com');
        expect(calls[0].headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    });

    it('9. adding a key does not unexpectedly change the active mode', async () => {
        // Simulate the settings panel: a credential is saved while the mode
        // stays at its default.
        await storeKey();
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');

        expect(getAIMode()).toBe('azemax-default');
        expect(isByokMode()).toBe(false);
        // …and the request still goes to Azemax Default.
        const { calls } = recordingFetch([{ body: { content: 'default' } }]);
        await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        expect(calls.every((c) => !c.headers.Authorization)).toBe(true);
    });

    it('10. switching modes preserves existing provider settings', async () => {
        await sessionStore.setCredentials({
            id: 'anthropic', name: 'Anthropic', apiKey: FAKE_KEY,
            model: 'claude-3-5-sonnet-20241022', rememberOnDevice: false,
        });
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');

        setAIMode('byok');
        expect(getSelectedProviderId()).toBe('anthropic');
        expect(getSetting('ai.defaultModel')).toBe('claude-3-5-sonnet-20241022');

        setAIMode('azemax-default');
        // The provider configuration survives the switch.
        expect(getSelectedProviderId()).toBe('anthropic');
        expect(getSetting('ai.defaultModel')).toBe('claude-3-5-sonnet-20241022');
        // …and the credential is still there.
        expect((await sessionStore.getCredentials('anthropic'))?.apiKey).toBe(FAKE_KEY);
    });

    it('11. removing a key does not leave a stale credential active', async () => {
        await storeKey();
        setSetting('ai.activeProvider', 'openai');
        setAIMode('byok');

        await sessionStore.removeCredentials('openai');
        expect(await sessionStore.getCredentials('openai')).toBeNull();

        // The next request fails with a configuration error — the deleted key
        // is never reused.
        const { calls } = recordingFetch([{ body: { content: 'server' } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR);
        expect(calls.length).toBe(0);
    });

    it('12. a missing provider configuration produces an actionable UI state', async () => {
        setAIMode('byok');
        setSetting('ai.activeProvider', '');

        const resolved = await resolveAIMode();
        expect(resolved.mode).toBe('byok');
        expect(resolved.status).toBe('needs-credential');
        expect(resolved.byokTarget).toBeNull();
        expect(resolved.message).toMatch(/provider is configured/i);
    });

    it('13. a persisted invalid mode is handled safely', async () => {
        setSetting('ai.mode', 'not-a-real-mode');
        // Falls back to the default mode instead of crashing.
        expect(getAIMode()).toBe('azemax-default');
        expect(isByokMode()).toBe(false);

        const resolved = await resolveAIMode();
        expect(resolved.mode).toBe('azemax-default');
        expect(resolved.status).toBe('ready');
    });

    it('13b. a persisted provider id this build does not know is coerced safely', async () => {
        // The settings store validates `ai.activeProvider` against the known
        // provider list, so an id from another build cannot even be persisted.
        setSetting('ai.activeProvider', 'some-removed-provider');
        expect(getSetting('ai.activeProvider')).toBe('');

        setSetting('ai.mode', 'byok');
        const resolved = await resolveAIMode();
        // The mode stays BYOK, and the state is actionable rather than a crash.
        expect(resolved.mode).toBe('byok');
        expect(resolved.status).toBe('needs-credential');
        expect(resolved.message).toMatch(/no provider is configured/i);
    });
});

describe('mode resolution against a stubbed store', () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock('../src/settings/settingsStore');
    });

    it('reports an unknown provider instead of crashing', async () => {
        // Reset the module registry so the dynamic import below picks up the
        // stubbed settings store.
        vi.resetModules();
        vi.doMock('../src/settings/settingsStore', () => ({
            getSetting: (key: string) => {
                if (key === 'ai.mode') return 'byok';
                if (key === 'ai.activeProvider') return 'a-provider-this-build-does-not-have';
                return '';
            },
            setSetting: () => undefined,
        }));

        const runtime = await import('../src/core/ai/byokRuntime');
        const resolved = await runtime.resolveAIMode();
        expect(resolved.mode).toBe('byok');
        expect(resolved.status).toBe('unknown-provider');
        expect(resolved.message).toMatch(/not available/i);

        // The request path reports it as a typed configuration error.
        await expect(runtime.resolveByokTarget()).rejects.toThrow(/Unknown AI provider/i);
    });
});

// ===========================================================================
// ERROR AND FALLBACK
// ===========================================================================

describe('mode-specific error handling', () => {
    const setupByok = async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: 'openai', name: 'OpenAI', apiKey: FAKE_KEY, model: 'gpt-4o', rememberOnDevice: false,
        });
    };

    it('14. invalid BYOK credentials do not trigger silent fallback', async () => {
        await setupByok();
        const { calls } = recordingFetch([{ status: 401, body: { error: { message: 'bad key' } } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR);
        expect(calls.length).toBe(1);
        // The mode is untouched.
        expect(getAIMode()).toBe('byok');
    });

    it('15. BYOK rate limits do not trigger silent fallback', async () => {
        await setupByok();
        const { calls } = recordingFetch([{ status: 429, body: { error: { message: 'slow down' } } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
        expect(calls.length).toBe(1);
        expect(getAIMode()).toBe('byok');
    });

    it('16. BYOK provider outages do not change the selected mode', async () => {
        await setupByok();
        recordingFetch([{ status: 503, body: { error: { message: 'down' } } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        expect(getAIMode()).toBe('byok');
        expect(getSelectedProviderId()).toBe('openai');
    });

    it('18. changing provider configuration does not corrupt an active task', async () => {
        await setupByok();
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'a.txt', content: 'a' }) } }] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        const task = runAgentController({
            userMessage: 'create a file called a.txt',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        await new Promise((r) => setTimeout(r, 0));
        // Switch the provider mid-task.
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');

        const res = await task;
        expect(res.changedWorkspace).toBe(true);
        expect(ws.content('a.txt')).toBe('a');
        // Every step of the RUNNING task used the original provider.
        expect(calls.every((c) => c.url.includes('api.openai.com'))).toBe(true);
        expect(calls.every((c) => c.headers.Authorization === `Bearer ${FAKE_KEY}`)).toBe(true);
    });
});

// ===========================================================================
// INTEGRATION
// ===========================================================================

describe('mode integration with chat and agent flows', () => {
    it('19. a default-model request can execute a valid tool call', async () => {
        // The backend returns a tool call; the agent executes it.
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'index.html', content: '<h1>Hi</h1>' }) } }] } },
            { body: { content: 'Created index.html' } },
        ]);

        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'create a simple website',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        expect(ws.content('index.html')).toBe('<h1>Hi</h1>');
        expect(res.changedWorkspace).toBe(true);
        // The default path went through the backend, not a BYOK provider.
        expect(calls.every((c) => c.url.includes('/ai/chat'))).toBe(true);
    });

    it('20. the default provider receives the actual tool result', async () => {
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'a.txt', content: 'hello' }) } }] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        await runAgentController({
            userMessage: 'create a file called a.txt',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        const last = JSON.parse(calls[calls.length - 1].body);
        const toolMessages = (last.messages ?? []).filter((m: { role: string }) => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
        expect(String(toolMessages[0].content)).toContain('a.txt');
    });

    it('21. a multi-step task continues through the configured default model', async () => {
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'a.txt', content: 'a' }) } }] } },
            { body: { content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'b.txt', content: 'b' }) } }] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'create two files',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        expect(ws.content('a.txt')).toBe('a');
        expect(ws.content('b.txt')).toBe('b');
        expect(res.changedWorkspace).toBe(true);
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it('22. a BYOK task continues to use its configured provider', async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: 'openai', name: 'OpenAI', apiKey: FAKE_KEY, model: 'gpt-4o', rememberOnDevice: false,
        });

        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_file', arguments: JSON.stringify({ path: 'x.txt', content: 'x' }) } }] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        await runAgentController({
            userMessage: 'create a file called x.txt',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        expect(ws.content('x.txt')).toBe('x');
        expect(calls.every((c) => c.url.includes('api.openai.com'))).toBe(true);
        expect(calls.every((c) => c.headers.Authorization === `Bearer ${FAKE_KEY}`)).toBe(true);
    });
});
