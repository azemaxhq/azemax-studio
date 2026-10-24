/**
 * BYOK end-to-end tests: provider routing, fallback policy, and the agent
 * loop running against a MOCKED provider.
 *
 * All provider responses here are MOCKED. No live provider is contacted and
 * no real API key is used — every credential is a fake string.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendChatResult, streamChat } from '../src/core/ai/AIClient';
import { sessionStore } from '../src/core/ai/credentialStore';
import { setSetting } from '../src/settings/settingsStore';
import { AI_ERROR_CODES } from '../src/core/ai/AIError';
import { runAgentController } from '../src/core/ai/agentController';
import type { FileNode } from '../src/utils/mockFileSystem';
import { ROOT_NODE_ID } from '../src/utils/mockFileSystem';
import {
    createFile as opCreateFile,
    ensureFolderPath,
    updateFileContent as opUpdateFileContent,
} from '../src/core/filesystem/operations';
import { resolveResource } from '../src/core/filesystem/queries';
import { emitFileChange } from '../src/core/filesystem/fileChangeService';

const FAKE_KEY = 'sk-fake-byok-key-0000';

// ---------------------------------------------------------------------------
// Workspace stub (mirrors the shape used by the existing agent tests)
// ---------------------------------------------------------------------------

class WS {
    tree: FileNode[] = [];
    getFileTree = () => this.tree;
    private apply<T extends { changed: boolean; error?: unknown; node?: FileNode }>(op: (t: FileNode[]) => T, kind: 'created' | 'updated') {
        const r = op(this.tree);
        if (r.changed && !r.error) {
            this.tree = r.tree;
            if (r.node) emitFileChange({ kind, id: r.node.id, name: r.node.name });
        }
        return r;
    }
    createFile = (path: string, content = '') => {
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const dir = parts.join('/');
        if (dir) this.tree = ensureFolderPath(this.tree, dir).tree;
        const parent = dir ? resolveResource(this.tree, dir) : null;
        if (dir && !parent) return { error: { message: 'no parent' } };
        const r = this.apply((t) => opCreateFile(t, { name, parentId: dir ? parent!.id : ROOT_NODE_ID, content }), 'created');
        return r.error ? { error: r.error } : { changed: true };
    };
    updateFileContent = (id: string, c: string) => {
        const r = this.apply((t) => opUpdateFileContent(t, id, c), 'updated');
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
            updateFileContent: this.updateFileContent,
        } as never;
    }
}

// ---------------------------------------------------------------------------
// Mock provider helpers
// ---------------------------------------------------------------------------

const toolCall = (name: string, args: Record<string, unknown>, id: string) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
});

const chatResponse = (message: unknown) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ choices: [{ message }] }),
});

/** Records every outbound request so a test can assert the credential used. */
const recordingFetch = (
    responses: Array<{ status?: number; body?: unknown; sse?: string }>,
) => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    let i = 0;
    const impl = vi.fn(async (url: unknown, init: unknown) => {
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
        return chatResponse(spec.body ?? { content: 'ok' });
    });
    globalThis.fetch = impl as unknown as typeof fetch;
    return { impl, calls };
};

const originalFetch = globalThis.fetch;

beforeEach(async () => {
    vi.clearAllMocks();
    await sessionStore.clear();
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
// Provider routing
// ===========================================================================

describe('BYOK provider routing', () => {
    it('routes a chat request to the selected provider with its credential', async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: 'openai',
            name: 'OpenAI',
            apiKey: FAKE_KEY,
            model: 'gpt-4o',
            rememberOnDevice: false,
        });

        const { calls } = recordingFetch([{ body: { content: 'hello from openai' } }]);

        const result = await sendChatResult(
            [{ role: 'user', content: 'hi' }],
            { task: 'chat' },
        );

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toBe('hello from openai');
        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain('api.openai.com');
        expect(calls[0].headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
        expect(calls[0].body).toContain('gpt-4o');
    });

    it('never sends the credential to a different provider', async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'groq');
        setSetting('ai.defaultModel', 'llama-3.1-70b-versatile');
        await sessionStore.setCredentials({
            id: 'groq',
            name: 'Groq',
            apiKey: 'gsk-fake-groq-key',
            model: 'llama-3.1-70b-versatile',
            rememberOnDevice: false,
        });

        const { calls } = recordingFetch([{ body: { content: 'hi' } }]);
        await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(calls[0].url).toContain('api.groq.com');
        expect(calls[0].headers.Authorization).toBe('Bearer gsk-fake-groq-key');
    });

    it('uses the server path when no provider is selected', async () => {
        // No BYOK provider selected: the request goes to the backend, which
        // owns the server credential. The provider key is never involved.
        const { calls } = recordingFetch([{ body: { content: 'server answer' } }]);
        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });
        expect(result.ok).toBe(true);
        // The backend endpoint, not a provider endpoint.
        expect(calls[0].url).not.toContain('api.openai.com');
        expect(calls[0].url).not.toContain('api.groq.com');
    });
});

// ===========================================================================
// Fallback policy — a BYOK failure must NOT switch to a server provider
// ===========================================================================

describe('server fallback policy', () => {
    const selectProvider = async (providerId: ProviderId = 'openai') => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', providerId);
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: providerId,
            name: providerId,
            apiKey: FAKE_KEY,
            model: 'gpt-4o',
            rememberOnDevice: false,
        });
    };

    it('surfaces an authentication failure instead of falling back', async () => {
        await selectProvider();
        const { calls } = recordingFetch([{ status: 401, body: { error: { message: 'Incorrect API key' } } }]);

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR);
            expect(result.error.retryable).toBe(false);
        }
        // Exactly one request: the server provider was never contacted.
        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain('api.openai.com');
    });

    it('surfaces a rate limit instead of falling back', async () => {
        await selectProvider();
        const { calls } = recordingFetch([{ status: 429, body: { error: { message: 'Rate limit reached' } } }]);

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
            expect(result.error.retryable).toBe(true);
        }
        expect(calls.length).toBe(1);
    });

    it('surfaces a provider outage instead of falling back', async () => {
        await selectProvider();
        const { calls } = recordingFetch([{ status: 503, body: { error: { message: 'upstream down' } } }]);

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
        expect(calls.length).toBe(1);
    });

    it('surfaces a network failure instead of falling back', async () => {
        await selectProvider();
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
    });

    it('surfaces a missing credential as a configuration error', async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        // No credential stored.
        const { calls } = recordingFetch([{ body: { content: 'server' } }]);

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR);
        // The server provider was NOT used to paper over the missing key.
        expect(calls.length).toBe(0);
    });

    it('falls back to the server provider only when explicitly enabled', async () => {
        await selectProvider();
        setSetting('ai.allowServerFallback', true);

        // First call fails with 401 (the provider), the second (server) works.
        const { calls } = recordingFetch([
            { status: 401, body: { error: { message: 'Incorrect API key' } } },
            { body: { content: 'server answer' } },
        ]);

        const result = await sendChatResult([{ role: 'user', content: 'hi' }], { task: 'chat' });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.content).toBe('server answer');
        expect(calls.length).toBe(2);
        expect(calls[0].url).toContain('api.openai.com');
        expect(calls[1].url).not.toContain('api.openai.com');
    });

    it('does not fall back in the streaming path either', async () => {
        await selectProvider();
        const { calls } = recordingFetch([{ status: 401, body: { error: { message: 'Incorrect API key' } } }]);

        await expect(async () => {
            for await (const _event of streamChat([{ role: 'user', content: 'hi' }], { task: 'chat' })) {
                // consume
            }
        }).rejects.toThrow();

        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain('api.openai.com');
    });
});

// ===========================================================================
// Agent end-to-end against a mocked provider
// ===========================================================================

describe('BYOK agent end-to-end (mocked provider)', () => {
    beforeEach(async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'openai');
        setSetting('ai.defaultModel', 'gpt-4o');
        await sessionStore.setCredentials({
            id: 'openai',
            name: 'OpenAI',
            apiKey: FAKE_KEY,
            model: 'gpt-4o',
            rememberOnDevice: false,
        });
    });

    it('executes tools, feeds real results back, and reports the real files', async () => {
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'index.html', content: '<h1>Hi</h1>' }, 'c1')] } },
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'styles.css', content: 'body{}' }, 'c2')] } },
            { body: { content: 'Created the site.' } },
        ]);

        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'create a simple website',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        // The model really produced tool calls, and they really executed.
        expect(ws.content('index.html')).toBe('<h1>Hi</h1>');
        expect(ws.content('styles.css')).toBe('body{}');
        expect(res.changedWorkspace).toBe(true);
        expect(res.stopReason).toBe('done');
        expect(res.message).toContain('index.html');

        // Every model call went to the user's provider with their key.
        expect(calls.length).toBeGreaterThanOrEqual(3);
        for (const call of calls) {
            expect(call.url).toContain('api.openai.com');
            expect(call.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
        }

        // The tool result was fed back to the model in a later turn.
        const lastBody = JSON.parse(calls[calls.length - 1].body);
        const toolMessages = lastBody.messages.filter((m: any) => m.role === 'tool');
        expect(toolMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('does not fabricate completion when the provider fails', async () => {
        recordingFetch([{ status: 500, body: { error: { message: 'boom' } } }]);

        const ws = new WS();
        const res = await runAgentController({
            userMessage: 'create a simple website',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        expect(res.changedWorkspace).toBeFalsy();
        expect(res.stopReason).not.toBe('done');
        // No file was created.
        expect(ws.getFileTree().filter((n) => n.id !== ROOT_NODE_ID)).toHaveLength(0);
    });

    it('does not duplicate a successful filesystem mutation on retry', async () => {
        // The provider asks for the same file twice across turns; the second
        // request is a no-op because the file already exists.
        recordingFetch([
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'a.txt', content: 'one' }, 'c1')] } },
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'a.txt', content: 'one' }, 'c2')] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        await runAgentController({
            userMessage: 'create a file called a.txt',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        const files = ws.getFileTree().filter((n) => n.type === 'file' && n.name === 'a.txt');
        expect(files.length).toBe(1);
        expect(ws.content('a.txt')).toBe('one');
    });

    it('keeps the provider identity stable when settings change mid-task', async () => {
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'index.html', content: 'x' }, 'c1')] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        const task = runAgentController({
            userMessage: 'create a simple website',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        // Change the selected provider AND model WHILE the task is running.
        await new Promise((r) => setTimeout(r, 0));
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');

        const res = await task;

        // The running task kept its original provider, model and credential
        // for every step.
        expect(calls.length).toBeGreaterThanOrEqual(2);
        for (const call of calls) {
            expect(call.url).toContain('api.openai.com');
            expect(call.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
            expect(call.body).toContain('gpt-4o');
            expect(call.body).not.toContain('claude-3-5-sonnet');
        }
        expect(res.changedWorkspace).toBe(true);
    });

    it('applies a provider change to the NEXT task, not the running one', async () => {
        const { calls } = recordingFetch([
            { body: { content: '', tool_calls: [toolCall('create_file', { path: 'a.txt', content: 'a' }, 'c1')] } },
            { body: { content: 'done' } },
        ]);

        const ws = new WS();
        await runAgentController({
            userMessage: 'create a file called a.txt',
            workspace: ws.bridge(),
            fileName: null,
            history: [],
        });

        // Switch the provider for the next task.
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');
        await sessionStore.setCredentials({
            id: 'anthropic',
            name: 'Anthropic',
            apiKey: 'sk-ant-fake-key',
            model: 'claude-3-5-sonnet-20241022',
            rememberOnDevice: false,
        });

        const ws2 = new WS();
        await runAgentController({
            userMessage: 'create a file called b.txt',
            workspace: ws2.bridge(),
            fileName: null,
            history: [],
        });

        const last = calls[calls.length - 1];
        expect(last.url).toContain('api.anthropic.com');
        expect(last.headers.Authorization).toBe('Bearer sk-ant-fake-key');
        expect(last.body).toContain('claude-3-5-sonnet-20241022');
    });
});
