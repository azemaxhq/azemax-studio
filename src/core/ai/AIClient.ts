import { API_BASE } from '../../utils/apiClient';
import { isAbortError } from './AIAbortController';
import { streamFromBackend, streamFromOpenAI } from './AIStream';
import type { AIStreamEvent } from './types';
import { taskDefaults, DEFAULT_MODEL } from './AIContextBuilder';
import { cleanResponse, createVisibleContentFilter } from './AIResponseParser';
import type { AIRequestContext, AIRequestOptions, AIResult, ChatMessage } from './types';
import { AIPerfTracker, aiPerfCounters, isAIPerfEnabled } from './aiPerf';
import {
    AIError,
    AI_ERROR_CODES,
    classifyProviderError,
    allProvidersFailed,
} from './AIError';
import type { AIErrorCode } from './AIError';
import { buildDirectChain, OR_PREFIX, KILO_PREFIX } from './modelRouter';

/**
 * The single AI transport.
 *
 * Every feature sends and streams through `AIClient` — there is exactly one
 * streaming implementation on the client (the backend SSE endpoint, with a
 * direct OpenAI-compatible provider fallback when the backend is disabled).
 *
 * Centralized output-safety pipeline (runs HERE, before any component):
 *
 *   Provider
 *     → SSE parser (AIStream.parseSseBlocks)
 *     → reasoning/thinking filter (createVisibleContentFilter)
 *     → response sanitizer (cleanResponse for non-stream, policy sanitizers for
 *       editor inserts at the call site)
 *     → AIStreamBuffer (frame-coalesced, immediate first token)
 *     → UI
 *
 * No component may render raw provider output: `reasoning` events are dropped
 * here, and every `delta` passes through `createVisibleContentFilter` before it
 * is yielded. `reasoning` can never reach React, even for one frame.
 *
 * Error contract (typed, never content):
 *   - Every provider failure is normalized into an `AIError` (code/provider/
 *     model/retryable). `AIError` is THROWN, never returned as generated text.
 *   - `sendChatResult` wraps the same path in an `AIResult` discriminated union
 *     (`{ok:true,content} | {ok:false,error}`) for callers that prefer the
 *     structured gate.
 *   - A backend HTTP error is surfaced directly (no client-side re-fallback —
 *     the backend already ran its chain); `retryable:false` reflects that.
 *   - Aborts propagate immediately and never trigger fallbacks.
 *   - `allowFallback:false` (autocomplete / low-latency paths) uses ONLY the
 *     requested model on both the backend and direct paths.
 *   - Dev-only latency telemetry via `AIPerfTracker` (no-op in production).
 */

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const OR_BASE_URL = 'https://openrouter.ai/api/v1';
const KILO_BASE_URL = 'https://api.kilocode.ai/v1';

const backendEnabled = (import.meta.env?.VITE_USE_BACKEND_AI ?? 'true') !== 'false';

export const isBackendAiEnabled = (): boolean => backendEnabled;

/** Extracts the structured `error` object from a backend failure response. */
function readBackendError(response: Response): Promise<{
    message: string;
    code?: AIErrorCode;
    provider?: string;
    retryable?: boolean;
}> {
    return response.text().then((text) => {
        try {
            const body = JSON.parse(text);
            if (body?.error && typeof body.error === 'object') {
                return {
                    message: body.error.userMessage || body.error.message || 'AI request failed',
                    code: body.error.code,
                    provider: body.error.provider,
                    retryable: Boolean(body.error.retryable),
                };
            }
            if (typeof body?.error === 'string') {
                return { message: body.error || response.statusText };
            }
            return { message: body.details ? `${body.error}: ${body.details}` : (body.error || response.statusText) };
        } catch {
            return { message: text || response.statusText };
        }
    });
}

interface DirectEndpoint {
    url: string;
    apiKey: string;
    model: string;
}

function providerOf(model: string): string {
    if (model.startsWith('hf:')) return 'huggingface';
    if (model.startsWith(OR_PREFIX)) return 'openrouter';
    if (model.startsWith(KILO_PREFIX)) return 'kilocode';
    return 'groq';
}

function resolveDirectEndpoint(model: string): DirectEndpoint {
    if (model.startsWith('hf:')) {
        const apiKey = import.meta.env?.VITE_HF_TOKEN || '';
        if (!apiKey) throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: 'huggingface', model, retryable: false,
            message: 'HuggingFace token is required. Please set VITE_HF_TOKEN.',
        });
        return { url: `${import.meta.env?.VITE_HF_BASE_URL || 'https://router.huggingface.co/v1'}/chat/completions`, apiKey, model: model.slice(3) };
    }
    if (model.startsWith(OR_PREFIX)) {
        const apiKey = import.meta.env?.VITE_OPENROUTER_API_KEY || '';
        if (!apiKey) throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: 'openrouter', model, retryable: false,
            message: 'OpenRouter API key is required. Please set VITE_OPENROUTER_API_KEY.',
        });
        return { url: `${OR_BASE_URL}/chat/completions`, apiKey, model: model.slice(OR_PREFIX.length) };
    }
    if (model.startsWith(KILO_PREFIX)) {
        const apiKey = import.meta.env?.VITE_KILO_API_KEY || '';
        if (!apiKey) throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: 'kilocode', model, retryable: false,
            message: 'Kilo Code API key is required. Please set VITE_KILO_API_KEY.',
        });
        return { url: `${KILO_BASE_URL}/chat/completions`, apiKey, model: model.slice(KILO_PREFIX.length) };
    }
    const apiKey = import.meta.env?.VITE_GROQ_API_KEY || '';
    if (!apiKey) throw new AIError({
        code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
        provider: 'groq', model, retryable: false,
        message: 'API key is required. Please set it in the environment.',
    });
    return { url: `${GROQ_BASE_URL}/chat/completions`, apiKey, model };
}

function buildBackendBody(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): string {
    return JSON.stringify({
        messages,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        responseLength: context.responseLength || 'medium',
        stream,
        task: options.task,
        allowFallback: options.allowFallback,
    });
}

async function postBackend(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): Promise<Response> {
    return fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: buildBackendBody(messages, options, context, stream),
    });
}

async function postBackendWithRetry(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            return await postBackend(messages, options, context, stream);
        } catch (err: any) {
            lastErr = err;
            if (isAbortError(err)) throw err;
            const msg = String(err?.message || '');
            const isNetwork = /Failed to fetch|NetworkError|ECONNREFUSED|Connection refused|Load failed/i.test(msg);
            if (isNetwork && attempt === 0) {
                await new Promise(r => setTimeout(r, 600));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

function buildDirectBody(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    model: string,
    stream: boolean,
): string {
    const defaults = taskDefaults(options, context.responseLength);
    return JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? defaults.temperature,
        max_tokens: options.maxTokens || defaults.maxTokens,
        stream,
    });
}

async function postDirect(
    endpoint: DirectEndpoint,
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): Promise<Response> {
    return fetch(endpoint.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${endpoint.apiKey}`,
            'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
            'X-Title': 'Azemax',
        },
        signal: options.signal,
        body: buildDirectBody(messages, options, context, endpoint.model, stream),
    });
}

function contextChars(messages: ChatMessage[]): number {
    let n = 0;
    for (const m of messages) n += m.content ? m.content.length : 0;
    return n;
}

interface FilterStreamHooks {
    onFirstVisibleToken?: () => void;
    onVisibleToken?: () => void;
}

/**
 * Central reasoning/thinking gate for STREAMING.
 *
 * Wraps a normalized provider event stream so that:
 *   - every `delta` passes through `createVisibleContentFilter` (suppresses
 *     inline  thinking/response  and <thinking></thinking> blocks AND leading
 *     reasoning preambles even when split across chunks; drops unclosed
 *     thinking at stream end);
 *   - `reasoning` events are DROPPED entirely — reasoning never becomes a
 *     visible `delta`, so no component can render it;
 *   - pending content is flushed before `done`/`error`, so the final token is
 *     never lost.
 */
async function* filterVisibleStream(
    gen: AsyncGenerator<AIStreamEvent, void, unknown>,
    hooks: FilterStreamHooks = {},
): AsyncGenerator<AIStreamEvent, void, unknown> {
    const filter = createVisibleContentFilter();
    let firedFirst = false;
    const emitToken = (content: string) => {
        if (!firedFirst) {
            firedFirst = true;
            hooks.onFirstVisibleToken?.();
        }
        hooks.onVisibleToken?.();
        return { type: 'delta' as const, content };
    };

    for await (const event of gen) {
        switch (event.type) {
            case 'delta':
                if (event.content) {
                    const visible = filter.push(event.content);
                    if (visible) yield emitToken(visible);
                }
                break;
            case 'reasoning':
                // Reasoning is NEVER surfaced as visible content.
                break;
            case 'done':
            case 'error': {
                const tail = filter.end();
                if (tail) yield emitToken(tail);
                yield event;
                break;
            }
            default:
                yield event;
        }
    }
}

/** Classifies a direct-provider HTTP failure into a typed AIError. */
function directError(err: unknown, model: string): AIError {
    if (err instanceof AIError) return err;
    return classifyProviderError({
        provider: providerOf(model),
        model,
        message: (err as Error)?.message,
        cause: err,
    });
}

async function* streamBackend(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    const tracker = new AIPerfTracker({
        task: options.task || 'chat',
        provider: 'backend',
        model: options.model || DEFAULT_MODEL,
        contextChars: contextChars(messages),
        contextBuildMs: context.contextBuildMs,
    });
    try {
        tracker.providerStarted();
        const response = await postBackendWithRetry(messages, options, context, true);
        if (!response.ok) {
            const err = await readBackendError(response);
            tracker.fail(err.message);
            tracker.log();
            // The backend already ran its full fallback chain — surface its
            // verdict directly, never re-run the chain client-side.
            throw new AIError({
                code: err.code || AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
                provider: err.provider,
                model: options.model,
                status: response.status,
                retryable: false,
                message: err.message,
            });
        }
        tracker.firstByteReceived();
        for await (const event of filterVisibleStream(streamFromBackend(response, options.signal), {
            onFirstVisibleToken: () => tracker.firstTokenReceived(),
            onVisibleToken: () => {
                tracker.tokenReceived();
                tracker.chunkReceived();
            },
        })) {
            if (event.type === 'done' && event.usage) {
                tracker.reportUsage(
                    event.usage.prompt_tokens,
                    event.usage.completion_tokens,
                    event.usage.completion_tokens_details?.reasoning_tokens,
                );
            }
            yield event;
        }
        tracker.complete();
        tracker.log();
    } catch (err) {
        if (isAbortError(err)) {
            tracker.abort();
            tracker.log();
        }
        throw err;
    }
}

async function* streamDirectChain(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    allowFallback: boolean,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    const chain = buildDirectChain(options.task || 'chat', options.model, { allowFallback });
    for (const model of chain) {
        let sawDelta = false;
        const tracker = new AIPerfTracker({
            task: options.task || 'chat',
            provider: providerOf(model),
            model,
            contextChars: contextChars(messages),
            contextBuildMs: context.contextBuildMs,
        });
        try {
            const endpoint = resolveDirectEndpoint(model);
            tracker.providerStarted();
            const response = await postDirect(endpoint, messages, options, context, true);
            if (!response.ok) {
                const err = await readBackendError(response);
                tracker.fail(err.message);
                tracker.log();
                throw directError(new AIError({
                    code: err.code || AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
                    provider: providerOf(model),
                    model,
                    status: response.status,
                    retryable: true,
                    message: err.message,
                }), model);
            }
            tracker.firstByteReceived();
            for await (const event of filterVisibleStream(streamFromOpenAI(response, options.signal), {
                onFirstVisibleToken: () => {
                    sawDelta = true;
                    tracker.firstTokenReceived();
                },
                onVisibleToken: () => {
                    tracker.tokenReceived();
                    tracker.chunkReceived();
                },
            })) {
                if (event.type === 'delta') sawDelta = true;
                if (event.type === 'done' && event.usage) {
                    tracker.reportUsage(
                        event.usage.prompt_tokens,
                        event.usage.completion_tokens,
                        event.usage.completion_tokens_details?.reasoning_tokens,
                    );
                }
                yield event;
            }
            tracker.complete();
            tracker.log();
            return;
        } catch (err) {
            if (isAbortError(err)) {
                tracker.abort();
                tracker.log();
                throw err;
            }
            const aiErr = directError(err, model);
            // If a model emitted deltas and THEN failed, falling back would
            // re-run the whole generation and duplicate tokens already shown.
            if (sawDelta || !aiErr.retryable) {
                tracker.fail((err as Error)?.message);
                tracker.log();
                throw aiErr;
            }
            tracker.fail((err as Error)?.message);
            tracker.log();
            if (!allowFallback) throw aiErr;
            if (isAIPerfEnabled()) aiPerfCounters.fallbacks++;
            console.warn(`[AIClient] Direct stream model ${model} failed:`, aiErr.message);
        }
    }
    throw allProvidersFailed(chain.map((m) => ({ provider: providerOf(m), model: m })));
}

/**
 * Streams a chat completion. Yields normalized events (`start` / `model` /
 * `delta` / `reasoning` / `done` / `error`). The caller must not await the full
 * response — deltas arrive in real time.
 */
export async function* streamChat(
    messages: ChatMessage[],
    options: AIRequestOptions = {},
    context: AIRequestContext = {},
): AsyncGenerator<AIStreamEvent, void, unknown> {
    const allowFallback = options.allowFallback ?? true;
    if (isAIPerfEnabled()) aiPerfCounters.requests++;
    if (backendEnabled) {
        let sawDelta = false;
        try {
            for await (const event of streamBackend(messages, options, context)) {
                if (event.type === 'delta' || event.type === 'reasoning') sawDelta = true;
                yield event;
            }
            return;
        } catch (err) {
            if (isAbortError(err)) throw err;
            // Never fall back once content has already streamed — restarting
            // would show the same tokens twice in the visible response.
            if (sawDelta) throw err;
            const aiErr = err instanceof AIError ? err : directError(err, options.model || DEFAULT_MODEL);
            // Definitive backend verdict (its whole chain failed, or an
            // auth/config/abort) is surfaced directly — no client re-fallback.
            if (!aiErr.retryable) throw aiErr;
            if (!allowFallback) throw aiErr;
            console.warn('[AIClient] Backend stream failed, falling back to direct providers:', aiErr.message);
        }
    }
    let fallbackSawDelta = false;
    try {
        for await (const event of streamDirectChain(messages, options, context, allowFallback)) {
            if (event.type === 'delta' || event.type === 'reasoning') fallbackSawDelta = true;
            yield event;
        }
    } catch (err) {
        if (isAbortError(err)) throw err;
        // Never fall back once content has already streamed
        if (fallbackSawDelta) throw err;
        throw err;
    }
}

/**
 * Non-streaming chat completion. Returns the cleaned assistant content.
 * Provider failures THROW a typed `AIError` — never an error-as-content string.
 * Callers that feed text into the editor MUST use `sendChatResult` and gate on `ok`,
 * or catch the thrown `AIError` and avoid applying error text as code.
 */
export async function sendChat(
    messages: ChatMessage[],
    options: AIRequestOptions = {},
    context: AIRequestContext = {},
): Promise<string> {
    const result = await sendChatResult(messages, options, context);
    if (!result.ok) {
        throw result.error;
    }
    if (!result.content || result.content.trim() === '') {
        throw new AIError({
            code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
            retryable: false,
            message: 'AI returned an empty response',
        });
    }
    return result.content;
}

/**
 * Non-streaming chat completion returning the `AIResult` discriminated union:
 * `{ok:true,content} | {ok:false,error}`. Callers that feed text into the
 * editor MUST gate on `ok` — only `ok:true` content may reach the sanitizer →
 * validator → Monaco pipeline.
 */
export async function sendChatResult(
    messages: ChatMessage[],
    options: AIRequestOptions = {},
    context: AIRequestContext = {},
): Promise<AIResult> {
    const allowFallback = options.allowFallback ?? true;
    const tracker = new AIPerfTracker({
        task: options.task || 'chat',
        provider: backendEnabled ? 'backend' : 'direct',
        model: options.model || DEFAULT_MODEL,
        contextChars: contextChars(messages),
        contextBuildMs: context.contextBuildMs,
    });
    if (isAIPerfEnabled()) aiPerfCounters.requests++;
    if (backendEnabled) {
        try {
            tracker.providerStarted();
            const response = await postBackendWithRetry(messages, options, context, false);
            if (!response.ok) {
                const err = await readBackendError(response);
                tracker.fail(err.message);
                tracker.log();
                throw new AIError({
                    code: err.code || AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
                    provider: err.provider,
                    model: options.model,
                    status: response.status,
                    retryable: false,
                    message: err.message,
                });
            }
            const data = await response.json();
            tracker.reportUsage(
                data.usage?.prompt_tokens,
                data.usage?.completion_tokens,
                data.usage?.completion_tokens_details?.reasoning_tokens,
            );
            const content = cleanResponse(data.choices?.[0]?.message?.content || '');
            if (!content) {
                throw new AIError({
                    code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
                    model: options.model,
                    retryable: false,
                    message: 'AI returned an empty response',
                });
            }
            tracker.complete();
            tracker.log();
            return {
                ok: true,
                content,
                model: data.model || options.model,
                provider: data.provider,
                usage: data.usage,
                requestId: data.requestId,
            };
        } catch (err) {
            if (isAbortError(err)) {
                tracker.abort();
                tracker.log();
                throw err;
            }
            const aiErr = err instanceof AIError ? err : classifyProviderError({ message: (err as Error)?.message, cause: err, model: options.model });
            // Backend answered with a real error: its chain already ran. No
            // client-side re-fallback, surface the typed error directly.
            if (!aiErr.retryable || err instanceof AIError) {
                tracker.fail(aiErr.message);
                tracker.log();
                return { ok: false, error: aiErr };
            }
            if (!allowFallback) {
                tracker.fail(aiErr.message);
                tracker.log();
                return { ok: false, error: aiErr };
            }
            console.warn('[AIClient] Backend chat failed, falling back to direct providers:', aiErr.message);
        }
    }

    const chain = buildDirectChain(options.task || 'chat', options.model, { allowFallback });
    for (const model of chain) {
        const attempt = new AIPerfTracker({
            task: options.task || 'chat',
            provider: providerOf(model),
            model,
            contextChars: contextChars(messages),
            contextBuildMs: context.contextBuildMs,
        });
        try {
            const endpoint = resolveDirectEndpoint(model);
            attempt.providerStarted();
            const response = await postDirect(endpoint, messages, options, context, false);
            if (!response.ok) {
                const err = await readBackendError(response);
                attempt.fail(err.message);
                attempt.log();
                throw directError(new AIError({
                    code: err.code || AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
                    provider: providerOf(model),
                    model,
                    status: response.status,
                    retryable: true,
                    message: err.message,
                }), model);
            }
            const data = await response.json();
            attempt.reportUsage(
                data.usage?.prompt_tokens,
                data.usage?.completion_tokens,
                data.usage?.completion_tokens_details?.reasoning_tokens,
            );
            const content = cleanResponse(data.choices?.[0]?.message?.content || '');
            if (!content) {
                throw new AIError({
                    code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
                    provider: providerOf(model), model,
                    retryable: false,
                    message: 'AI returned an empty response',
                });
            }
            attempt.complete();
            attempt.log();
            return { ok: true, content, model, provider: providerOf(model), usage: data.usage };
        } catch (err) {
            if (isAbortError(err)) {
                attempt.abort();
                attempt.log();
                throw err;
            }
            const aiErr = directError(err, model);
            attempt.fail(aiErr.message);
            attempt.log();
            if (!allowFallback || !aiErr.retryable) return { ok: false, error: aiErr };
            if (isAIPerfEnabled()) aiPerfCounters.fallbacks++;
            console.warn(`[AIClient] Direct chat model ${model} failed:`, aiErr.message);
        }
    }
    return {
        ok: false,
        error: allProvidersFailed(chain.map((m) => ({ provider: providerOf(m), model: m }))),
    };
}