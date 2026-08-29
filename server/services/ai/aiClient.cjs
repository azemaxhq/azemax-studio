const { AI_MODELS, CORS_ORIGIN } = require('../../config/index.cjs');
const { classifyProviderError, AIError, AI_ERROR_CODES } = require('./aiError.cjs');

const OR_PREFIX = 'or:';
const HF_PREFIX = 'hf:';
const KILO_PREFIX = 'kilo:';

function stripORPrefix(model) {
    return model.startsWith(OR_PREFIX) ? model.slice(OR_PREFIX.length) : model;
}

function stripHFPrefix(model) {
    return model.startsWith(HF_PREFIX) ? model.slice(HF_PREFIX.length) : model;
}

function stripKiloPrefix(model) {
    return model.startsWith(KILO_PREFIX) ? model.slice(KILO_PREFIX.length) : model;
}

function isORModel(model) {
    return model.startsWith(OR_PREFIX);
}

function isHFModel(model) {
    return model.startsWith(HF_PREFIX);
}

function isKiloModel(model) {
    return model.startsWith(KILO_PREFIX);
}

function isNvidiaModel(model) {
    if (!model) return false;
    if (model.startsWith('nvidia/')) return true;
    if (model === AI_MODELS.nvidia.default) return true;
    if (model === 'deepseek-ai/deepseek-v4-flash-0731') return true;
    if (model.startsWith('deepseek-ai/')) return true;
    return false;
}

function getMaxTokens(responseLength = 'medium') {
    switch (responseLength) {
        case 'short': return 1200;
        case 'long': return 3000;
        default: return 2500;
    }
}

const GROQ_MODEL_IDS = new Set([
    'qwen/qwen3.6-27b',
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'allam-2-7b',
    'groq/compound',
    'groq/compound-mini',
]);

const KILO_MODEL_IDS = new Set([
    'nemotron-3-super',
    'gpt-4o',
    'claude-3.5-sonnet',
]);

function inferProvider(model) {
    if (!model) return 'nvidia';
    if (isHFModel(model)) return 'huggingface';
    if (isORModel(model)) return 'openrouter';
    if (isKiloModel(model)) return 'kilocode';
    if (isNvidiaModel(model)) return 'nvidia';
    if (model.startsWith('deepseek-ai/')) return 'nvidia';
    if (GROQ_MODEL_IDS.has(model)) return 'groq';
    if (KILO_MODEL_IDS.has(model)) return 'kilocode';
    if (model.includes('/')) return 'openrouter';
    return 'groq';
}

/**
 * Resolves the request endpoint + key for a provider/model.
 * Every endpoint string lives HERE (single source of truth — no endpoint
 * strings are scattered through the codebase).
 */
function resolveEndpoint(provider) {
    switch (provider) {
        case 'nvidia':
            return { url: `${AI_MODELS.nvidia.baseUrl}/chat/completions`, apiKey: AI_MODELS.nvidia.apiKey };
        case 'groq':
            return { url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: AI_MODELS.groq.apiKey };
        case 'openrouter':
            return { url: AI_MODELS.openRouter.baseUrl, apiKey: AI_MODELS.openRouter.apiKey };
        case 'huggingface':
            return { url: AI_MODELS.huggingFace.baseUrl, apiKey: AI_MODELS.huggingFace.apiKey };
        case 'kilocode':
            return { url: `${AI_MODELS.kiloCode?.baseUrl || 'https://api.kilocode.ai/v1'}/chat/completions`, apiKey: AI_MODELS.kiloCode?.apiKey || '' };
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

/**
 * OpenAI-compatible chat completion. `resolved` is a model-router object
 * (`{ provider, model, chatTemplateKwargs, forceNonemptyContent, maxTokens }`)
 * that already carries provider-specific parameters, so this function never
 * decides what to send — the router does.
 *
 * - Only parameters the provider supports are sent (never `chat_template_kwargs`
 *   for non-NVIDIA providers; never `reasoning_budget`).
 * - Streaming uses the caller's abort signal. Non-streaming requests get a hard
 *   timeout so a hung provider fails fast and the fallback can take over.
 * - HTTP failures are normalized into typed AIErrors before they propagate.
 * - Reasoning content is stripped from final responses.
 *   For non-streaming responses, reasoning_content is stripped from the final message.
 *   For streaming, reasoning is filtered at the stream level.
 */
async function chatCompletion({ provider, model, messages, temperature = 0.6, top_p = null, maxTokens = 2500, stream = false, signal, chatTemplateKwargs = null, forceNonemptyContent = false, timeoutMs = null }) {
    const resolvedProvider = provider || inferProvider(model);
    const { url, apiKey } = resolveEndpoint(resolvedProvider);

    let resolvedModel = model;
    if (resolvedProvider === 'nvidia') {
        resolvedModel = model || AI_MODELS.nvidia.default;
    } else if (resolvedProvider === 'groq') {
        resolvedModel = stripORPrefix(stripHFPrefix(model || AI_MODELS.groq.default));
    } else if (resolvedProvider === 'openrouter') {
        resolvedModel = stripORPrefix(model || 'minimax/minimax-m3:free');
    } else if (resolvedProvider === 'huggingface') {
        resolvedModel = stripHFPrefix(model || AI_MODELS.huggingFace.defaultModel);
        stream = false; // HF router does not stream in this integration
    } else if (resolvedProvider === 'kilocode') {
        resolvedModel = stripKiloPrefix(model || 'nemotron-3-super');
    }

    // Minimax M3 via OpenRouter is handled via standard fetch (same as other OpenRouter models)
    // The OpenRouter SDK example from the user is equivalent to fetch to https://openrouter.ai/api/v1/chat/completions
    // Our existing fetch + pipeProviderStream already correctly handles minimax streaming and reasoning
    // (verified: direct fetch for minimax returns correct content and usage with reasoningTokens)

    if (!apiKey) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: resolvedProvider,
            model: resolvedModel,
            status: 503,
            retryable: true,
            message: `${resolvedProvider} API key is not configured on the server`,
        });
    }

    // Timeouts: DeepSeek with high reasoning (16384 tokens) needs 60-90s. Previous 3s caused
    // "only loading" intermittency. Use tiered timeouts: DeepSeek high reasoning gets 60s/90s,
    // normal DeepSeek 12s/20s, others 30s/60s.
    const isDeepSeek = typeof resolvedModel === 'string' && resolvedModel.includes('deepseek');
    const isHighReasoning = chatTemplateKwargs?.reasoning_effort === 'high' || (typeof chatTemplateKwargs?.thinking === 'boolean' && chatTemplateKwargs.thinking === true);
    const defaultTimeout = isDeepSeek
        ? (isHighReasoning
            ? (stream ? 60000 : 90000)
            : (stream ? 12000 : 20000))
        : (stream ? 30000 : 60000);
    const effectiveTimeout = timeoutMs != null ? timeoutMs : defaultTimeout;
    let requestSignal = signal;
    if (typeof AbortSignal.timeout === 'function') {
        const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
        const signals = [signal, timeoutSignal].filter(Boolean);
        requestSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    }

    // Cap max_tokens per provider to avoid 413 Payload Too Large.
    // Minimax M3 supports large context (up to 32k) — allow 16k for full potential.
    let cappedMaxTokens = maxTokens;
    if (resolvedProvider === 'groq' && cappedMaxTokens > 4096) cappedMaxTokens = 4096;
    if (resolvedProvider === 'openrouter') {
        const isMinimax = resolvedModel.includes('minimax');
        if (isMinimax && cappedMaxTokens > 16384) cappedMaxTokens = 16384;
        else if (!isMinimax && cappedMaxTokens > 8192) cappedMaxTokens = 8192;
    }
    if (resolvedProvider === 'huggingface' && cappedMaxTokens > 2048) cappedMaxTokens = 2048;
    if (resolvedProvider === 'kilocode' && cappedMaxTokens > 4096) cappedMaxTokens = 4096;

    const body = {
        model: resolvedModel,
        messages,
        temperature,
        max_tokens: cappedMaxTokens,
        stream,
    };
    if (top_p != null) body.top_p = top_p;

    // Provider-specific request capabilities (NVIDIA-only reasoning knobs).
    // `chatTemplateKwargs` comes pre-built by the router — we never construct
    // reasoning controls here, and never send them to non-NVIDIA providers.
    if (resolvedProvider === 'nvidia') {
        const kwargs = { ...(chatTemplateKwargs || {}) };
        if (forceNonemptyContent) kwargs.force_nonempty_content = true;
        if (Object.keys(kwargs).length > 0) body.chat_template_kwargs = kwargs;
    }

    const t0 = Date.now();
    let response;
    let lastFetchError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'HTTP-Referer': CORS_ORIGIN,
                    'X-Title': 'Azemax',
                },
                body: JSON.stringify(body),
                signal: requestSignal,
            });
            if (!response.ok) {
                const retryableStatus = response.status === 429 || response.status >= 500;
                if (retryableStatus && attempt === 0) {
                    const txt = await response.text().catch(() => '');
                    // brief backoff before retrying same provider
                    await new Promise(r => setTimeout(r, 700 + Math.random() * 500));
                    lastFetchError = { status: response.status, text: txt };
                    continue;
                }
                let text = '';
                try {
                    text = await response.text();
                } catch {
                    /* body unreadable — classification still works from status */
                }
                throw classifyProviderError({
                    provider: resolvedProvider,
                    model: resolvedModel,
                    status: response.status,
                    message: `${resolvedProvider} request failed: ${response.status}`,
                    cause: text || null,
                    latencyMs: Date.now() - t0,
                });
            }
            break; // success
        } catch (err) {
            // If already an AIError (from !ok branch), rethrow immediately
            if (err && err.name === 'AIError') throw err;
            const msg = String(err && err.message || '');
            const isAbort = err && (err.name === 'AbortError' || /abort/i.test(msg));
            if (isAbort) {
                throw classifyProviderError({
                    provider: resolvedProvider,
                    model: resolvedModel,
                    message: msg,
                    cause: err,
                    latencyMs: Date.now() - t0,
                });
            }
            const isNetwork = /fetch failed|Failed to fetch|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|terminated/i.test(msg);
            if (isNetwork && attempt === 0) {
                lastFetchError = err;
                await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
                continue;
            }
            throw classifyProviderError({
                provider: resolvedProvider,
                model: resolvedModel,
                message: msg,
                cause: err,
                latencyMs: Date.now() - t0,
            });
        }
    }
    if (!response || !response.ok) {
        // Should have thrown already, but defensively handle retry exhaustion
        if (lastFetchError && typeof lastFetchError === 'object' && 'status' in lastFetchError) {
            throw classifyProviderError({
                provider: resolvedProvider,
                model: resolvedModel,
                status: lastFetchError.status,
                message: `${resolvedProvider} request failed: ${lastFetchError.status}`,
                cause: lastFetchError.text || null,
                latencyMs: Date.now() - t0,
            });
        }
        throw classifyProviderError({
            provider: resolvedProvider,
            model: resolvedModel,
            message: lastFetchError ? String(lastFetchError.message || lastFetchError) : 'Provider request failed after retry',
            cause: lastFetchError,
            latencyMs: Date.now() - t0,
        });
    }

    // For non-streaming responses, strip reasoning_content from the final message
    if (!stream) {
        const data = await response.json();
        if (data.choices && data.choices[0] && data.choices[0].message) {
            // Strip reasoning_content from the message
            if (data.choices[0].message.reasoning_content) {
                delete data.choices[0].message.reasoning_content;
            }
        }
        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: response.headers,
        });
    }

    // Streaming responses are returned raw. Reasoning separation happens in
    // `pipeProviderStream` (aiStream.cjs) — the ONE canonical filter — which
    // reads delta.reasoning_content into a PRIVATE channel and forwards only
    // delta.content through createVisibleContentFilter. Never duplicate that
    // logic here.
    return response;
}

function listModels() {
    const models = [];

    if (AI_MODELS.nvidia.apiKey) {
        const isDeepSeek = AI_MODELS.nvidia.default.includes('deepseek');
        models.push({
            id: AI_MODELS.nvidia.default,
            provider: 'nvidia',
            label: isDeepSeek ? 'DeepSeek V4 Flash (NVIDIA - Premium Efficient)' : 'Nemotron 3 Super 120B (NVIDIA)',
            primary: true,
        });
    }

    if (AI_MODELS.groq.apiKey) {
        models.push(
            { id: 'qwen/qwen3.6-27b', provider: 'groq', label: 'Qwen 3.6 27B (Groq)' },
            { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)' },
            { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)' },
            { id: 'allam-2-7b', provider: 'groq', label: 'Allam 2 7B (Groq)' },
        );
    }

    if (AI_MODELS.openRouter.apiKey) {
        for (const id of AI_MODELS.openRouter.fallbacks) {
            models.push({
                id: `${OR_PREFIX}${id}`,
                provider: 'openrouter',
                label: id,
            });
        }
    }

    if (AI_MODELS.huggingFace.apiKey) {
        models.push({
            id: `${HF_PREFIX}${AI_MODELS.huggingFace.defaultModel}`,
            provider: 'huggingface',
            label: AI_MODELS.huggingFace.defaultModel,
        });
    }

    if (AI_MODELS.kiloCode?.apiKey) {
        models.push(
            { id: `${KILO_PREFIX}nemotron-3-super`, provider: 'kilocode', label: 'Nemotron 3 Super (Kilo Code)' },
            { id: `${KILO_PREFIX}gpt-4o`, provider: 'kilocode', label: 'GPT-4o (Kilo Code)' },
            { id: `${KILO_PREFIX}claude-3.5-sonnet`, provider: 'kilocode', label: 'Claude 3.5 Sonnet (Kilo Code)' },
        );
    }

    return models;
}

module.exports = {
    OR_PREFIX,
    HF_PREFIX,
    KILO_PREFIX,
    isORModel,
    isHFModel,
    isKiloModel,
    isNvidiaModel,
    stripORPrefix,
    stripHFPrefix,
    stripKiloPrefix,
    inferProvider,
    getMaxTokens,
    resolveEndpoint,
    chatCompletion,
    listModels,
};