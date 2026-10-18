import { API_BASE } from '../../utils/apiClient';
import { authHeaders } from '../../utils/authToken';
import { isAbortError } from './AIAbortController';
import { streamFromBackend, streamFromOpenAI } from './AIStream';
import type { AIStreamEvent, AIToolCall } from './types';
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
    // Security: direct provider calls embed the key in the BROWSER. This path
    // exists for local development only (VITE_USE_BACKEND_AI=false) and is
    // compiled out of production builds — the production guard in
    // vite.config.ts blanks the keys, and this throws even if one leaks in.
    if (!import.meta.env?.DEV) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: providerOf(model), model, retryable: false,
            message: 'Direct provider access is disabled in production. AI requests go through the backend.',
        });
    }
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

/**
 * Normalizes a provider's raw `message.tool_calls` into our wire shape.
 *
 * Malformed entries are DROPPED, never repaired: a call with no name or a
 * non-string id is not a valid tool call and must not reach dispatch.
 */
/**
 * Convert a single provider item (native or alternative shape) into our wire
 * type. Provider compatibility adapters across vendors use different envelopes:
 *   - OpenAI/OpenRouter/NVIDIA: { id, type, function: { name, arguments } }
 *   - Bare tool-call objects:    { id?, name, arguments? | args? | params? }
 *   - A bare object on its own is never a tool call — it must at least carry
 *     a `name` string.
 */
function normalizeOneToolCall(item: unknown, index: number): AIToolCall | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;

    let name = '';
    let rawArgs: unknown = '';
    let id = '';

    const fn = (obj as { function?: unknown }).function;
    if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
        const f = fn as Record<string, unknown>;
        if (typeof f.name === 'string' && f.name) {
            name = f.name;
            rawArgs = f.arguments ?? f.args ?? f.parameters ?? '';
            id = typeof obj.id === 'string' ? obj.id : '';
        }
    }
    if (!name && typeof obj.name === 'string' && obj.name) {
        name = obj.name;
        rawArgs = obj.arguments ?? obj.args ?? obj.params ?? obj.input ?? '';
        id = typeof obj.id === 'string' ? obj.id : '';
    }
    if (!name) return null;

    let argumentsString = '';
    if (typeof rawArgs === 'string') {
        argumentsString = rawArgs;
    } else if (rawArgs === undefined || rawArgs === null || rawArgs === '') {
        argumentsString = '{}';
    } else {
        try {
            argumentsString = JSON.stringify(rawArgs);
        } catch {
            argumentsString = '';
        }
    }
    if (!id) id = `call_${name}_${index}`;
    return { id, type: 'function', function: { name, arguments: argumentsString } };
}

export function normalizeToolCalls(raw: unknown): AIToolCall[] {
    // A single bare object may be a tool call (some providers serialize one
    // call without an array wrapper).
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
        const one = normalizeOneToolCall(raw, 0);
        return one ? [one] : [];
    }
    if (!Array.isArray(raw)) return [];
    const out: AIToolCall[] = [];
    for (const item of raw) {
        const call = normalizeOneToolCall(item, out.length);
        if (call) out.push(call);
    }
    return out;
}

/**
 * Extract structured tool calls that a provider mistakenly serialized inside
 * the assistant `content` field as JSON instead of `tool_calls`.
 *
 * Only a *complete, standalone* tool-call payload is converted: the trimmed
 * content must be JSON and deserialize to one or more objects carrying a
 * string `name` (and optionally arguments/args/parameters/input). Ordinary
 * prose or fenced code blocks are never touched, so genuine code/JSON
 * answers stay intact.
 *
 * Returns `null` when the content is not a tool-call payload.
 */
export function extractToolCallsFromContent(content: unknown): AIToolCall[] | null {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    // Strip a single Markdown code fence, if present, before parsing.
    let body = trimmed;
    const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) body = fence[1].trim();
    if (!body.startsWith('{') && !body.startsWith('[')) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) return null;
    const calls = normalizeToolCalls(arr);
    // Require every array entry to have survived validation as a tool call,
    // so a stray JSON array (e.g. [{"name":"x"}]) inside a real code sample
    // is only treated as a tool call if ALL entries look like calls.
    if (calls.length !== arr.length) return null;
    // A lone object without arguments is only a tool call if it also carries
    // an explicit `arguments`/`args` field. This prevents a plain JSON object
    // that happens to have `name` from being misclassified.
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i] as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(obj, 'arguments') &&
            !Object.prototype.hasOwnProperty.call(obj, 'args') &&
            !Object.prototype.hasOwnProperty.call(obj, 'parameters') &&
            !Object.prototype.hasOwnProperty.call(obj, 'input')) {
            if (arr.length === 1 && (obj as { tool_calls?: unknown }).tool_calls === undefined) {
                // permit only if name matches a known tool? We don't have catalog here;
                // keep strict to avoid false positives.
                return null;
            }
        }
    }
    return calls;
}

/**
 * Serializes messages for transport, keeping the tool-calling fields that the
 * older hand-rolled JSON stringify dropped (`tool_calls`, `tool_call_id`,
 * `name`). `content` is always coerced to a string — several OpenAI-compatible
 * providers reject `null`.
 */
function serializeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
        const out: Record<string, unknown> = { role: m.role, content: typeof m.content === 'string' ? m.content : '' };
        if (m.tool_calls && m.tool_calls.length) out.tool_calls = m.tool_calls;
        if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
        if (m.name) out.name = m.name;
        return out;
    });
}

function buildBackendBody(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): string {
    const body: Record<string, unknown> = {
        messages: serializeMessages(messages),
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        responseLength: context.responseLength || 'medium',
        stream,
        task: options.task,
        allowFallback: options.allowFallback,
    };
    // Omitted entirely for every non-agent feature so existing chat/explain/
    // autocomplete requests are byte-identical to before tool calling.
    if (options.tools && options.tools.length) {
        body.tools = options.tools;
        body.toolChoice = options.toolChoice || 'auto';
    }
    return JSON.stringify(body);
}

async function postBackend(
    messages: ChatMessage[],
    options: AIRequestOptions,
    context: AIRequestContext,
    stream: boolean,
): Promise<Response> {
    return fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        // Bearer fallback for cross-site beta (cookie blocked); server also
        // accepts the request outright when auth is disabled server-side.
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
    const body: Record<string, unknown> = {
        model,
        messages: serializeMessages(messages),
        temperature: options.temperature ?? defaults.temperature,
        max_tokens: options.maxTokens || defaults.maxTokens,
        stream,
    };
    if (options.tools && options.tools.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice || 'auto';
    }
    return JSON.stringify(body);
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
            const nativeToolCalls = normalizeToolCalls(data.choices?.[0]?.message?.tool_calls);
            const rawContent = data.choices?.[0]?.message?.content || '';
            const extracted = nativeToolCalls.length ? null : extractToolCallsFromContent(rawContent);
            const toolCalls = extracted ?? nativeToolCalls;
            const content = cleanResponse(extracted ? '' : (rawContent || ''));
            // A tool-call turn legitimately carries NO visible content — only
            // the structured calls. Treating that as "empty response" is what
            // previously made native tool calling impossible.
            if (!content && toolCalls.length === 0) {
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
                toolCalls,
                finishReason: data.choices?.[0]?.finish_reason,
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
            const nativeToolCalls2 = normalizeToolCalls(data.choices?.[0]?.message?.tool_calls);
            const rawContent2 = data.choices?.[0]?.message?.content || '';
            const extracted2 = nativeToolCalls2.length ? null : extractToolCallsFromContent(rawContent2);
            const toolCalls = extracted2 ?? nativeToolCalls2;
            const content = cleanResponse(extracted2 ? '' : (rawContent2 || ''));
            if (!content && toolCalls.length === 0) {
                throw new AIError({
                    code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
                    provider: providerOf(model), model,
                    retryable: false,
                    message: 'AI returned an empty response',
                });
            }
            attempt.complete();
            attempt.log();
            return {
                ok: true,
                content,
                toolCalls,
                finishReason: data.choices?.[0]?.finish_reason,
                model,
                provider: providerOf(model),
                usage: data.usage,
            };
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