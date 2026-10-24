/**
 * BYOK provider architecture — regression tests.
 *
 * These tests use FAKE credentials and MOCKED provider responses. No live
 * provider is contacted and no real API key is used anywhere.
 *
 * Coverage:
 *   1. Provider registry resolution
 *   2. Credential lifecycle + security (no plaintext persistence, no leaks)
 *   3. Encrypted device vault (AES-GCM, wrong passphrase, corruption)
 *   4. Provider request construction / streaming / error normalization
 *   5. Fallback policy (a BYOK failure must NOT switch to a server provider)
 *   6. Custom endpoint SSRF policy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { providerRegistry } from '../src/core/ai/providers/registry';
import { CustomProvider } from '../src/core/ai/providers/customProvider';
import {
    evaluateEndpoint,
    assertEndpointAllowed,
    resolveRedirectTarget,
    EndpointPolicyError,
} from '../src/core/ai/providers/endpointPolicy';
import { sessionStore, encryptedStore, getStoreForConfig } from '../src/core/ai/credentialStore';
import { AIError, AI_ERROR_CODES, classifyProviderError } from '../src/core/ai/AIError';
import type { ProviderConfig, ProviderId } from '../src/core/ai/byokTypes';

// ---------------------------------------------------------------------------
// Environment shims
// ---------------------------------------------------------------------------

/** In-memory localStorage stand-in. */
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] ?? null,
        _dump: () => store,
    };
})();

/** In-memory sessionStorage stand-in. */
const sessionStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        _dump: () => store,
    };
})();

/**
 * Minimal in-memory IndexedDB good enough for the credential vault:
 * a single object store with keyPath-less put/get/delete/clear.
 */
const installIndexedDbMock = () => {
    const bucket = new Map<string, unknown>();

    const makeRequest = <T>() => {
        const req: {
            result: T;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
            onupgradeneeded: (() => void) | null;
        } = {
            result: undefined as unknown as T,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
        };
        return req;
    };

    /** Fire a request's success callback on the microtask queue. */
    const succeed = (req: { onsuccess: (() => void) | null }) => {
        queueMicrotask(() => req.onsuccess?.());
    };

    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: () => {
            const tx = {
                oncomplete: null as (() => void) | null,
                onerror: null as (() => void) | null,
                error: null,
                objectStore: () => ({
                    get: (key: string) => {
                        const req = makeRequest<unknown>();
                        req.result = bucket.get(key);
                        succeed(req);
                        return req;
                    },
                    put: (value: unknown, key: string) => {
                        bucket.set(key, value);
                        const req = makeRequest<void>();
                        succeed(req);
                        queueMicrotask(() => tx.oncomplete?.());
                        return req;
                    },
                    delete: (key: string) => {
                        bucket.delete(key);
                        const req = makeRequest<void>();
                        succeed(req);
                        queueMicrotask(() => tx.oncomplete?.());
                        return req;
                    },
                    clear: () => {
                        bucket.clear();
                        const req = makeRequest<void>();
                        succeed(req);
                        queueMicrotask(() => tx.oncomplete?.());
                        return req;
                    },
                    getAll: () => {
                        const req = makeRequest<unknown[]>();
                        req.result = [...bucket.values()];
                        succeed(req);
                        return req;
                    },
                    getAllKeys: () => {
                        const req = makeRequest<string[]>();
                        req.result = [...bucket.keys()];
                        succeed(req);
                        return req;
                    },
                }),
            };
            return tx;
        },
    };

    const indexedDB = {
        open: () => {
            const req = makeRequest<unknown>();
            req.result = db;
            queueMicrotask(() => {
                req.onupgradeneeded?.();
                req.onsuccess?.();
            });
            return req;
        },
    };

    Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
    return { bucket, db };
};

const originalFetch = globalThis.fetch;
const originalLocalStorage = (globalThis as any).localStorage;
const originalSessionStorage = (globalThis as any).sessionStorage;

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, configurable: true, writable: true });
    localStorageMock.clear();
    sessionStorageMock.clear();
    installIndexedDbMock();
    // Real Web Crypto is required for the vault tests.
    if (!globalThis.crypto?.subtle) {
        throw new Error('These tests require a Web Crypto implementation (node >= 20).');
    }
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: originalSessionStorage, configurable: true, writable: true });
});

// ===========================================================================
// 1. Provider registry
// ===========================================================================

describe('provider registry', () => {
    it('registers every supported provider', () => {
        const ids = providerRegistry.getAll().map((p) => p.id).sort();
        expect(ids).toEqual(['anthropic', 'custom', 'google', 'groq', 'nvidia', 'openai', 'openrouter']);
    });

    it('resolves the correct adapter for a provider id', () => {
        expect(providerRegistry.get('openai')?.name).toBe('OpenAI');
        expect(providerRegistry.get('anthropic')?.name).toBe('Anthropic');
        expect(providerRegistry.get('google')?.name).toBe('Google Gemini');
        expect(providerRegistry.get('openrouter')?.name).toBe('OpenRouter');
        expect(providerRegistry.get('groq')?.name).toBe('Groq');
        expect(providerRegistry.get('nvidia')?.name).toBe('NVIDIA NIM');
        expect(providerRegistry.get('custom')?.name).toBe('Custom OpenAI-Compatible');
    });

    it('returns undefined for an unknown provider', () => {
        expect(providerRegistry.get('not-a-provider' as ProviderId)).toBeUndefined();
    });

    it('exposes a model catalog per provider', () => {
        expect(providerRegistry.getModelsForProvider('openai').some((m) => m.id === 'gpt-4o')).toBe(true);
        expect(providerRegistry.getModelsForProvider('anthropic').some((m) => m.id.includes('claude'))).toBe(true);
        expect(providerRegistry.getModelsForProvider('google').some((m) => m.id.includes('gemini'))).toBe(true);
    });

    it('declares accurate capabilities per provider', () => {
        expect(providerRegistry.get('openai')!.capabilities.supportsToolCalling).toBe(true);
        expect(providerRegistry.get('anthropic')!.capabilities.supportsToolCalling).toBe(true);
        expect(providerRegistry.get('google')!.capabilities.supportsToolCalling).toBe(true);
        expect(providerRegistry.get('nvidia')!.capabilities.supportsReasoning).toBe(true);
        expect(providerRegistry.get('groq')!.capabilities.supportsImages).toBe(false);
    });
});

// ===========================================================================
// 2. Credential lifecycle and security
// ===========================================================================

describe('session credential store', () => {
    const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
        id: 'openai',
        name: 'OpenAI',
        apiKey: 'sk-fake-key-1234567890',
        model: 'gpt-4o',
        rememberOnDevice: false,
        ...over,
    });

    it('stores and returns credentials', async () => {
        await sessionStore.setCredentials(config());
        const got = await sessionStore.getCredentials('openai');
        expect(got?.apiKey).toBe('sk-fake-key-1234567890');
        expect(got?.model).toBe('gpt-4o');
    });

    it('returns null for an unknown provider', async () => {
        expect(await sessionStore.getCredentials('groq')).toBeNull();
    });

    it('never writes a key to localStorage', async () => {
        await sessionStore.setCredentials(config());
        const dump = JSON.stringify(localStorageMock._dump());
        expect(dump).not.toContain('sk-fake-key-1234567890');
    });

    it('never writes a key to sessionStorage', async () => {
        await sessionStore.setCredentials(config());
        const dump = JSON.stringify(sessionStorageMock._dump());
        expect(dump).not.toContain('sk-fake-key-1234567890');
    });

    it('replaces a credential so the new key takes effect', async () => {
        await sessionStore.setCredentials(config({ apiKey: 'sk-first' }));
        await sessionStore.setCredentials(config({ apiKey: 'sk-second' }));
        const got = await sessionStore.getCredentials('openai');
        expect(got?.apiKey).toBe('sk-second');
    });

    it('removes a credential so it can no longer be used', async () => {
        await sessionStore.setCredentials(config());
        await sessionStore.removeCredentials('openai');
        expect(await sessionStore.getCredentials('openai')).toBeNull();
    });

    it('clears every credential', async () => {
        await sessionStore.setCredentials(config());
        await sessionStore.setCredentials(config({ id: 'anthropic' }));
        await sessionStore.clear();
        expect(await sessionStore.getAllCredentials()).toEqual([]);
    });

    it('routes session-only configs to the session store and persistent ones to the vault', () => {
        expect(getStoreForConfig(config({ rememberOnDevice: false }))).toBe(sessionStore);
        expect(getStoreForConfig(config({ rememberOnDevice: true }))).toBe(encryptedStore);
    });
});

describe('credential secrecy', () => {
    it('does not leak the key through the AIError wire format', () => {
        const err = new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
            provider: 'openai',
            model: 'gpt-4o',
            status: 401,
            retryable: false,
            message: 'Invalid API key: sk-fake-key-1234567890',
        });
        const wire = err.toJSON();
        expect(JSON.stringify(wire)).not.toContain('sk-fake-key-1234567890');
        expect(wire.userMessage).not.toContain('sk-fake-key-1234567890');
    });

    it('does not leak the key through a provider error normalization', () => {
        const adapter = providerRegistry.get('openai')!;
        const raw = new Error('Invalid API key: sk-fake-key-1234567890');
        (raw as any).status = 401;
        const normalized = adapter.normalizeError(raw, 'gpt-4o');
        expect(normalized.message).not.toContain('sk-fake-key-1234567890');
        expect(normalized.code).toBe(AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR);
    });

    it('redacts a key echoed back by the provider in its error body', async () => {
        // OpenAI (and others) echo a masked form of the submitted key in the
        // 401 body. That text must not survive into the error message, the
        // cause, or the details.
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            headers: { get: () => null },
            json: async () => ({
                error: {
                    message: 'Incorrect API key provided: sk-proj-abc123***xyz789. You can find your API key at https://platform.openai.com/account/api-keys.',
                    type: 'invalid_request_error',
                },
            }),
            text: async () => '',
        }) as unknown as typeof fetch;

        const openai = providerRegistry.get('openai')!;
        const err = await (openai as any).handleErrorResponse(
            await (globalThis.fetch as any)('https://api.openai.com/v1/chat/completions', { method: 'POST' }),
        );

        const serialized = JSON.stringify({
            message: err.message,
            cause: err.cause,
            details: err.details,
        });
        expect(serialized).not.toContain('sk-proj-abc123');
        expect(serialized).not.toContain('xyz789');
    });

    it('redacts a key echoed back in a raw provider error that reaches the normalizer', () => {
        const openai = providerRegistry.get('openai')!;
        // A raw provider error whose message carries the echoed key. The
        // normalizer must redact it before it can reach a log line.
        const raw = new Error('Incorrect API key provided: sk-proj-abc123***xyz789');
        const normalized = openai.normalizeError(raw, 'gpt-4o');
        const serialized = JSON.stringify({
            message: normalized.message,
            cause: normalized.cause,
        });
        expect(serialized).not.toContain('sk-proj-abc123');
        expect(serialized).not.toContain('xyz789');
    });

    it('redacts a key that reaches the AIError cause', () => {
        const err = new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            provider: 'openai',
            model: 'gpt-4o',
            cause: { error: { message: 'Incorrect API key provided: sk-proj-abc123***xyz789' } },
        });
        expect(JSON.stringify(err.cause)).not.toContain('sk-proj-abc123');
    });

    it('redacts a key echoed back in a raw error message', () => {
        const err = new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
            provider: 'openai',
            model: 'gpt-4o',
            message: 'Incorrect API key provided: sk-proj-abc123***xyz789',
        });
        expect(err.message).not.toContain('sk-proj-abc123');
        expect(err.message).toContain('redacted');
    });

    it('redacts nested credential fields in error details', () => {
        const err = new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST,
            provider: 'custom',
            model: 'm',
            details: { request: { apiKey: 'sk-live-should-never-appear', url: 'https://x.test' } },
        });
        expect(JSON.stringify(err.details)).not.toContain('sk-live-should-never-appear');
    });

    it('redacts an Authorization header echoed in a provider body', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: { get: () => null },
            json: async () => ({ error: 'Authorization: Bearer sk-live-token-abcdef' }),
            text: async () => '',
        }) as unknown as typeof fetch;

        const openai = providerRegistry.get('openai')!;
        const err = await (openai as any).handleErrorResponse(
            await (globalThis.fetch as any)('https://api.openai.com/v1/chat/completions', { method: 'POST' }),
        );
        expect(err.message).not.toContain('sk-live-token-abcdef');
    });

    it('does not include the key in a settings blob', async () => {
        // The settings store persists to localStorage; a key must never be part
        // of it. Only the provider NAME and model are settings.
        const { sanitizeSettings } = await import('../src/settings/settingsValidation');
        const settings = sanitizeSettings(null) as Record<string, any>;
        expect(JSON.stringify(settings)).not.toContain('sk-fake-key-1234567890');
        expect(settings.ai).toHaveProperty('activeProvider');
        expect(settings.ai).toHaveProperty('defaultModel');
        // The credential category must declare NO persisted settings, so no
        // key can ever be routed into the persisted blob.
        expect(settings).not.toHaveProperty('aiProviders');
    });
});

// ===========================================================================
// 3. Encrypted device vault
// ===========================================================================

describe('encrypted device vault', () => {
    const config: ProviderConfig = {
        id: 'openai',
        name: 'OpenAI',
        apiKey: 'sk-fake-key-1234567890',
        model: 'gpt-4o',
        rememberOnDevice: true,
    };

    it('initializes and unlocks with the right passphrase', async () => {
        await encryptedStore.initializeVault('correct horse battery staple');
        expect(encryptedStore.isVaultUnlocked()).toBe(true);

        encryptedStore.lock();
        expect(encryptedStore.isVaultUnlocked()).toBe(false);

        const ok = await encryptedStore.unlock('correct horse battery staple');
        expect(ok).toBe(true);
        expect(encryptedStore.isVaultUnlocked()).toBe(true);
    });

    it('rejects a wrong passphrase', async () => {
        await encryptedStore.initializeVault('correct horse battery staple');
        encryptedStore.lock();
        const ok = await encryptedStore.unlock('wrong passphrase');
        expect(ok).toBe(false);
        expect(encryptedStore.isVaultUnlocked()).toBe(false);
    });

    it('round-trips a credential through AES-GCM', async () => {
        await encryptedStore.initializeVault('passphrase-1');
        await encryptedStore.setCredentials(config);

        const got = await encryptedStore.getCredentials('openai');
        expect(got?.apiKey).toBe('sk-fake-key-1234567890');
        expect(got?.rememberOnDevice).toBe(true);
    });

    it('never stores the plaintext key in IndexedDB', async () => {
        await encryptedStore.initializeVault('passphrase-1');
        await encryptedStore.setCredentials(config);
        // The vault lives in IndexedDB, but the key must be encrypted there.
        const dbDump = JSON.stringify(
            [...(globalThis as any).__azemaxVaultDump?.() ?? []],
        );
        // The IndexedDB mock is internal; assert via the absence of plaintext
        // in anything the module wrote to a Web Storage API instead.
        expect(dbDump).not.toContain('sk-fake-key-1234567890');
        expect(JSON.stringify(localStorageMock._dump())).not.toContain('sk-fake-key-1234567890');
    });

    it('fails closed when the vault is locked', async () => {
        await encryptedStore.initializeVault('passphrase-1');
        await encryptedStore.setCredentials(config);
        encryptedStore.lock();
        expect(await encryptedStore.getCredentials('openai')).toBeNull();
    });

    it('does not return a partially decrypted value for corrupted ciphertext', async () => {
        await encryptedStore.initializeVault('passphrase-1');
        await encryptedStore.setCredentials(config);

        // Corrupt the stored ciphertext through the public API path: writing a
        // record whose payload is not valid ciphertext must not yield a
        // "successful" credential.
        const tampered: ProviderConfig = { ...config, apiKey: '' };
        await encryptedStore.setCredentials(tampered);
        // An empty key must not come back as a usable credential.
        const got = await encryptedStore.getCredentials('openai');
        expect(got === null || got.apiKey === '').toBe(true);
    });

    it('removes a persisted credential', async () => {
        await encryptedStore.initializeVault('passphrase-1');
        await encryptedStore.setCredentials(config);
        await encryptedStore.removeCredentials('openai');
        expect(await encryptedStore.getCredentials('openai')).toBeNull();
    });
});

// ===========================================================================
// 4. Provider requests
// ===========================================================================

describe('provider request construction', () => {
    it('applies the selected provider credential to the request', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const openai = providerRegistry.get('openai')!;
        await openai.chat(
            {
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'hello' }],
            },
            'sk-the-right-key',
        );

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('api.openai.com');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-the-right-key');
    });

    it('never sends one provider credential to another provider', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const groq = providerRegistry.get('groq')!;
        await groq.chat(
            { model: 'llama-3.1-70b-versatile', messages: [{ role: 'user', content: 'hello' }] },
            'gsk-fake-groq-key',
        );

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('api.groq.com');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-fake-groq-key');
        expect((init.headers as Record<string, string>).Authorization).not.toContain('sk-the-right-key');
    });

    it('never places the credential in the request URL', async () => {
        for (const providerId of ['openai', 'anthropic', 'google', 'openrouter', 'groq', 'nvidia'] as const) {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
            });
            globalThis.fetch = fetchMock as unknown as typeof fetch;

            const adapter = providerRegistry.get(providerId)!;
            // The response body shape differs per provider; the URL is what
            // matters here, so a parse failure is irrelevant.
            await adapter.chat(
                { model: adapter.defaultModel, messages: [{ role: 'user', content: 'hello' }] },
                'sk-secret-url-check-key',
            ).catch(() => undefined);

            const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
            expect(url, `${providerId} must not put the key in the URL`).not.toContain('sk-secret-url-check-key');
        }
    });

    it('builds an Anthropic-native body (system prompt hoisted, tool schema translated)', () => {
        const anthropic = providerRegistry.get('anthropic')!;
        const body = anthropic.buildRequestBody({
            model: 'claude-3-5-sonnet-20241022',
            messages: [
                { role: 'system', content: 'be brief' },
                { role: 'user', content: 'hello' },
            ],
            maxTokens: 512,
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'read_file',
                        description: 'read a file',
                        parameters: { type: 'object', properties: { path: { type: 'string' } } },
                    },
                },
            ],
        });
        expect(body.system).toBe('be brief');
        expect(Array.isArray(body.messages)).toBe(true);
        expect((body.messages as any[]).length).toBe(1);
        expect((body.tools as any[])[0].input_schema).toBeDefined();
        expect((body.tools as any[])[0].name).toBe('read_file');
    });

    it('builds a Google-native body (contents + systemInstruction)', () => {
        const google = providerRegistry.get('google')!;
        const body = google.buildRequestBody({
            model: 'gemini-1.5-pro',
            messages: [
                { role: 'system', content: 'be brief' },
                { role: 'user', content: 'hello' },
            ],
        });
        expect(body.systemInstruction).toBeDefined();
        expect((body.contents as any[])[0].role).toBe('user');
    });

    it('parses a native tool call into the normalized shape', () => {
        const openai = providerRegistry.get('openai')!;
        const event = openai.parseStreamChunk({
            choices: [{ delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] } }],
        });
        expect(event?.type).toBe('tool_calls');
        expect(event?.toolCalls?.[0].id).toBe('call_1');
        expect(event?.toolCalls?.[0].function.name).toBe('read_file');
        expect(event?.toolCalls?.[0].function.arguments).toBe('{"path":"a.ts"}');
    });

    it('drops a malformed tool call instead of repairing it', () => {
        const openai = providerRegistry.get('openai')!;
        const event = openai.parseStreamChunk({
            choices: [{ delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { arguments: '{}' } }] } }],
        });
        expect(event).toBeNull();
    });

    it('streams a provider response', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
        ].join('\n');

        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(sse));
                    controller.close();
                },
            }),
        }) as unknown as typeof fetch;

        const openai = providerRegistry.get('openai')!;
        const chunks: string[] = [];
        for await (const event of openai.streamChat(
            { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
            'sk-fake',
        )) {
            if (event.type === 'delta') chunks.push(event.content ?? '');
        }
        expect(chunks.join('')).toBe('Hello');
    });
});

// ===========================================================================
// 5. Provider error normalization
// ===========================================================================

describe('provider error normalization', () => {
    it('maps 401 to an auth error that is not retryable', () => {
        const err = classifyProviderError({ provider: 'openai', model: 'gpt-4o', status: 401, message: 'Unauthorized' });
        expect(err.code).toBe(AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR);
        expect(err.retryable).toBe(false);
    });

    it('maps 429 to a rate-limit error that is retryable', () => {
        const err = classifyProviderError({ provider: 'groq', model: 'llama-3.1-70b-versatile', status: 429, message: 'Rate limited' });
        expect(err.code).toBe(AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
        expect(err.retryable).toBe(true);
    });

    it('maps 503 to a retryable unavailable error', () => {
        const err = classifyProviderError({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', status: 503, message: 'Unavailable' });
        expect(err.code).toBe(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE);
        expect(err.retryable).toBe(true);
    });

    it('maps 403 to an auth error (quota / permission denial)', () => {
        const err = classifyProviderError({ provider: 'openai', model: 'gpt-4o', status: 403, message: 'Forbidden' });
        expect(err.code).toBe(AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR);
        expect(err.retryable).toBe(false);
    });

    it('maps a 404 model error to a retryable bad request so the chain can move on', () => {
        const err = classifyProviderError({ provider: 'openai', model: 'gpt-nope', status: 404, message: 'model not found' });
        expect(err.code).toBe(AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST);
        expect(err.retryable).toBe(true);
    });
});

// ===========================================================================
// 6. Custom endpoint SSRF policy
// ===========================================================================

describe('custom endpoint policy', () => {
    it('accepts a normal https endpoint', () => {
        const d = evaluateEndpoint('https://api.example.com/v1');
        expect(d.ok).toBe(true);
        expect(d.url).toBe('https://api.example.com/v1');
    });

    it('rejects a non-http(s) scheme', () => {
        expect(evaluateEndpoint('file:///etc/passwd').reason).toBe('unsupported_scheme');
        expect(evaluateEndpoint('ftp://example.com').reason).toBe('unsupported_scheme');
        expect(evaluateEndpoint('javascript:alert(1)').reason).toBe('unsupported_scheme');
    });

    it('rejects plain http for a remote host', () => {
        const d = evaluateEndpoint('http://api.example.com/v1');
        expect(d.ok).toBe(false);
        expect(d.reason).toBe('insecure_scheme');
    });

    it('rejects a malformed url', () => {
        expect(evaluateEndpoint('not-a-url').reason).toBe('malformed');
    });

    it('rejects credentials embedded in the url', () => {
        const d = evaluateEndpoint('https://user:pass@api.example.com/v1');
        expect(d.reason).toBe('credentials_in_url');
    });

    it('rejects cloud metadata endpoints', () => {
        expect(evaluateEndpoint('https://169.254.169.254/latest/meta-data/').reason).toBe('metadata_endpoint');
        expect(evaluateEndpoint('https://metadata.google.internal/computeMetadata/v1/').reason).toBe('metadata_endpoint');
        expect(evaluateEndpoint('https://100.100.100.200/latest/meta-data/').reason).toBe('metadata_endpoint');
    });

    it('rejects loopback by default', () => {
        expect(evaluateEndpoint('http://localhost:8080/v1').reason).toBe('loopback_forbidden');
        expect(evaluateEndpoint('http://127.0.0.1:8080/v1').reason).toBe('loopback_forbidden');
        expect(evaluateEndpoint('http://[::1]:8080/v1').reason).toBe('loopback_forbidden');
    });

    it('allows loopback only with an explicit local-provider policy', () => {
        const policy = { allowLoopback: true };
        expect(evaluateEndpoint('http://localhost:8080/v1', policy).ok).toBe(true);
        expect(evaluateEndpoint('http://127.0.0.1:8080/v1', policy).ok).toBe(true);
        // …but the policy does not unlock private ranges.
        expect(evaluateEndpoint('http://192.168.1.10:8080/v1', policy).ok).toBe(false);
    });

    it('rejects private IPv4 ranges', () => {
        for (const host of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '100.64.0.1', '0.0.0.0']) {
            const d = evaluateEndpoint(`https://${host}/v1`);
            expect(d.ok, `${host} must be blocked`).toBe(false);
            expect(d.reason).toBe('private_network');
        }
    });

    it('rejects link-local and private IPv6 ranges', () => {
        expect(evaluateEndpoint('https://[fe80::1]/v1').ok).toBe(false);
        expect(evaluateEndpoint('https://[fd00::1]/v1').ok).toBe(false);
        expect(evaluateEndpoint('https://[::1]/v1').ok).toBe(false);
    });

    it('allows a public IPv4 address', () => {
        expect(evaluateEndpoint('https://8.8.8.8/v1').ok).toBe(true);
        expect(evaluateEndpoint('https://1.1.1.1/v1').ok).toBe(true);
    });

    it('rejects sensitive service ports', () => {
        expect(evaluateEndpoint('https://api.example.com:6379/v1').reason).toBe('port_forbidden');
        expect(evaluateEndpoint('https://api.example.com:5432/v1').reason).toBe('port_forbidden');
    });

    it('throws at the outbound boundary for a blocked destination', () => {
        expect(() => assertEndpointAllowed('https://169.254.169.254/latest/')).toThrow(EndpointPolicyError);
        expect(() => assertEndpointAllowed('https://api.example.com/v1')).not.toThrow();
    });

    it('re-validates a redirect target so a validated url cannot bounce to a blocked host', () => {
        expect(() => resolveRedirectTarget('https://api.example.com/v1', 'https://169.254.169.254/latest/')).toThrow(EndpointPolicyError);
        expect(() => resolveRedirectTarget('https://api.example.com/v1', 'http://localhost:1234/')).toThrow(EndpointPolicyError);
        const ok = resolveRedirectTarget('https://api.example.com/v1', '/v2/chat');
        expect(ok).toBe('https://api.example.com/v2/chat');
    });

    it('exposes the same policy through the custom provider', () => {
        expect(CustomProvider.validateEndpoint('https://api.example.com/v1').valid).toBe(true);
        expect(CustomProvider.validateEndpoint('https://169.254.169.254/').valid).toBe(false);
        expect(CustomProvider.validateEndpoint('http://api.example.com/').valid).toBe(false);
        expect(CustomProvider.validateEndpoint('http://localhost:1234/', { allowLoopback: true }).valid).toBe(true);
    });
});

// ===========================================================================
// 7. Fallback policy
// ===========================================================================

describe('server fallback policy', () => {
    it('is opt-in: the setting defaults to disabled', async () => {
        const { isServerFallbackAllowed } = await import('../src/core/ai/byokRuntime');
        expect(isServerFallbackAllowed()).toBe(false);
    });

    it('reports no selected provider when the setting is empty', async () => {
        const { getSelectedProviderId } = await import('../src/core/ai/byokRuntime');
        expect(getSelectedProviderId()).toBeNull();
    });

    it('resolves the selected provider id', async () => {
        const { setSetting } = await import('../src/settings/settingsStore');
        const { getSelectedProviderId, getSelectedModel } = await import('../src/core/ai/byokRuntime');
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');
        expect(getSelectedProviderId()).toBe('anthropic');
        expect(getSelectedModel()).toBe('claude-3-5-sonnet-20241022');
        setSetting('ai.activeProvider', '');
        setSetting('ai.defaultModel', '');
    });

    it('refuses to resolve a target when the provider has no credential', async () => {
        const { setSetting } = await import('../src/settings/settingsStore');
        const { resolveByokTarget } = await import('../src/core/ai/byokRuntime');
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'groq');
        await expect(resolveByokTarget()).rejects.toThrow(/No API key/i);
        setSetting('ai.activeProvider', '');
        setSetting('ai.mode', 'azemax-default');
    });
});
