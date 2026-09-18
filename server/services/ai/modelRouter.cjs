/**
 * MODEL ROUTER — the single place that decides which provider/model handles a
 * task and what reasoning/request parameters that model supports.
 *
 *   resolveModel(task, modelString)  -> ResolvedModel (primary metadata)
 *   buildRoutingPlan(task, model, opt) -> { primary, fallbacks }
 *
 * Routing policy (deterministic, config-driven):
 *   - NVIDIA Nemotron 3 Super is the PRIMARY provider/model family for every task.
 *   - Fallbacks are ONLY the configured secondary providers (Groq/Qwen,
 *     OpenRouter, HuggingFace, Kilo Code) — a provider without an API key never enters
 *     the chain, and a provider the health cache marks unhealthy is skipped.
 *   - Per-task reasoning is derived from `taskConfig` (`reasoningMode`); the
 *     router converts it into the provider-native request controls and only
 *     sends parameters the selected provider supports (capabilities).
 *   - Model selection never happens anywhere else in the app.
 */

const { AI_MODELS } = require('../../config/index.cjs');
const { getTaskConfig } = require('./taskConfig.cjs');
const { isConfigured, isHealthy } = require('./providerHealth.cjs');

const OR_PREFIX = 'or:';
const HF_PREFIX = 'hf:';
const KILO_PREFIX = 'kilo:';

// ============================================================================
// Provider capabilities (single source of truth for request construction)
// ============================================================================

const PROVIDER_CAPABILITIES = {
    nvidia: {
        supportsStreaming: true,
        supportsChatTemplateKwargs: true, // enable_thinking / reasoning_effort
        supportsForceNonempty: true,      // SGLang coding-agent knob (gated by config)
        supportsReasoning: true,
    },
    groq: {
        supportsStreaming: true,
        supportsChatTemplateKwargs: false,
        supportsForceNonempty: false,
        supportsReasoning: false,
    },
    openrouter: {
        supportsStreaming: true,
        supportsChatTemplateKwargs: false,
        supportsForceNonempty: false,
        supportsReasoning: false,
    },
    huggingface: {
        supportsStreaming: false,
        supportsChatTemplateKwargs: false,
        supportsForceNonempty: false,
        supportsReasoning: false,
    },
    kilocode: {
        supportsStreaming: true,
        supportsChatTemplateKwargs: false,
        supportsForceNonempty: false,
        supportsReasoning: false,
    },
};

function providerCapabilities(provider) {
    return PROVIDER_CAPABILITIES[provider] || { supportsStreaming: true };
}

// ============================================================================
// Model string -> provider + resolved model id
// ============================================================================

function stripPrefixes(model) {
    let m = model || '';
    if (m.startsWith(OR_PREFIX)) m = m.slice(OR_PREFIX.length);
    if (m.startsWith(HF_PREFIX)) m = m.slice(HF_PREFIX.length);
    return m;
}

const GROQ_MODEL_IDS = new Set([
    'qwen/qwen3.8-27b',
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
    if (model.startsWith(HF_PREFIX)) return 'huggingface';
    if (model.startsWith(OR_PREFIX)) return 'openrouter';
    if (model.startsWith(KILO_PREFIX)) return 'kilocode';
    if (model.startsWith('nvidia/') || model === AI_MODELS.nvidia.default) return 'nvidia';
    if (model === 'deepseek-ai/deepseek-v4-flash-0731' || model.startsWith('deepseek-ai/')) return 'nvidia';
    if (GROQ_MODEL_IDS.has(model)) return 'groq';
    if (KILO_MODEL_IDS.has(model)) return 'kilocode';
    if (model.includes('/')) return 'openrouter';
    return 'groq';
}

// ============================================================================
// Reasoning controls
// ============================================================================

const REASONING_MODES = ['off', 'low', 'medium', 'high'];

/**
 * Converts a task's reasoningMode into provider-native request controls.
 * NVIDIA is the only provider with native reasoning toggles; every other
 * provider returns null (the router never sends parameters it rejects).
 * `force_nonempty_content` is gated behind env config — the hosted API can
 * 503 on it, so it defaults OFF and only enables when explicitly configured.
 * 
 * Hosted Nemotron-3-Super live behavior (verified 2026-08):
 *   off  -> { enable_thinking: false, reasoning_effort: 'none' }
 *   low  -> { enable_thinking: true,  reasoning_effort: 'low'  }
 *   high -> { reasoning_effort: 'high' }  (enable_thinking + high 503s)
 * 'medium' is mapped to 'low' in the profile (no separate medium_effort).
 */
function buildNvidiaChatTemplateKwargs(profile, model) {
    const kwargs = {};
    const mode = profile.reasoningMode || 'off';
    const isDeepSeek = typeof model === 'string' && model.includes('deepseek');
    const thinkingKey = isDeepSeek ? 'thinking' : 'enable_thinking';
    if (mode === 'off') {
        kwargs[thinkingKey] = false;
        kwargs.reasoning_effort = 'none';
    } else if (mode === 'low' || mode === 'medium') {
        kwargs[thinkingKey] = true;
        kwargs.reasoning_effort = 'low';
    } else if (mode === 'high') {
        // For Nemotron, enable_thinking + high 503s, so send only reasoning_effort
        // For DeepSeek, send thinking:true + high (per user example)
        if (isDeepSeek) kwargs[thinkingKey] = true;
        kwargs.reasoning_effort = 'high';
    }
    const forceNonempty = profile.forceNonemptyContent && process.env.NVIDIA_FORCE_NONEMPTY === 'true';
    if (forceNonempty) kwargs.force_nonempty_content = true;
    return kwargs;
}

// ============================================================================
// resolveModel
// ============================================================================

/**
 * Resolves the effective model for a task. Returns structured metadata used by
 * the transport and recorded in perf metrics.
 *
 * @returns {{
 *   provider: string,
 *   model: string,
 *   task: string,
 *   reasoningMode: string,
 *   maxTokens: number,
 *   temperature: number,
 *   chatTemplateKwargs: object|null,
 *   forceNonemptyContent: boolean,
 *   capabilities: object,
 *   fallbackIndex: number,
 * }}
 */
function resolveModel(task, modelString, { fallbackIndex = 0 } = {}) {
    const profile = getTaskConfig(task);
    const provider = inferProvider(modelString);
    const model = stripPrefixes(modelString || AI_MODELS.nvidia.default);
    const caps = providerCapabilities(provider);

    let chatTemplateKwargs = null;
    if (caps.supportsChatTemplateKwargs && provider === 'nvidia') {
        chatTemplateKwargs = buildNvidiaChatTemplateKwargs(profile, model);
    }

    const forceNonemptyContent = Boolean(
        caps.supportsForceNonempty &&
        profile.forceNonemptyContent &&
        process.env.NVIDIA_FORCE_NONEMPTY === 'true',
    );

    return {
        provider,
        model,
        task,
        reasoningMode: REASONING_MODES.includes(profile.reasoningMode) ? profile.reasoningMode : 'off',
        maxTokens: profile.maxTokens,
        temperature: profile.temperature,
        chatTemplateKwargs,
        forceNonemptyContent,
        capabilities: caps,
        fallbackIndex,
    };
}

// ============================================================================
// Fallback candidates (configured providers only)
// ============================================================================

function configuredFallbackModels() {
    const list = [];
    // Premium efficient fallback: DeepSeek (primary, may hang) → Groq (fast, proven) → Kilo → OpenRouter → HF
    // Groq first for speed (qwen 950ms), Kilo after. Ensures DeepSeek timeout quickly falls back to working Groq.
    if (isConfigured('groq')) list.push(AI_MODELS.groq.default);
    if (isConfigured('kilocode')) list.push(`${KILO_PREFIX}nemotron-3-super`);
    if (isConfigured('openrouter')) list.push(`${OR_PREFIX}nvidia/nemotron-3-super-120b-a12b:free`);
    if (isConfigured('huggingface')) list.push(`${HF_PREFIX}${AI_MODELS.huggingFace.defaultModel}`);
    return list;
}

/**
 * Builds the ordered routing plan for a request.
 *
 * @param {string} task               backend task key
 * @param {string} [requestedModel]   explicit model (usually NVIDIA default)
 * @param {object} [opts]
 * @param {boolean} [opts.allowFallback=true]  false = primary only (low-latency paths)
 * @param {boolean} [opts.healthFilter=true]   skip unhealthy providers
 * @returns {{ primary: object, fallbacks: object[] }}
 */
function buildRoutingPlan(task, requestedModel, { allowFallback = true, healthFilter = true } = {}) {
    // Primary is the caller's requested model, defaulting to the configured
    // NVIDIA model. No forced override: hijacking the primary breaks
    // `allowFallback:false` callers (autocomplete) and sends every request to
    // a single provider even when it is down.
    // Latency exception: `fast_chat` (greetings/small talk, max 512 tokens) is
    // latency-critical and quality-insensitive — measured Groq TTFB ~0.35s vs
    // NVIDIA ~13s — so it defaults to the fast Groq model when configured.
    // An explicit requestedModel always wins.
    const fastDefault = (task === 'fast_chat' && isConfigured('groq')) ? AI_MODELS.groq.default : null;
    const primaryModel = requestedModel || fastDefault || AI_MODELS.nvidia.default;
    const primary = resolveModel(task, primaryModel, { fallbackIndex: 0 });

    if (!allowFallback) return { primary, fallbacks: [] };

    const candidates = configuredFallbackModels();
    const fallbacks = [];
    let idx = 1;
    const skippedDueToHealth = [];
    for (const candidate of candidates) {
        if (candidate === (requestedModel || primaryModel)) continue;
        const provider = inferProvider(candidate);
        if (healthFilter && !isHealthy(provider, candidate)) {
            skippedDueToHealth.push(candidate);
            continue;
        }
        fallbacks.push(resolveModel(task, candidate, { fallbackIndex: idx++ }));
    }
    // Deadlock avoidance: if health filtering removed ALL fallbacks but there were
    // configured candidates, include the most recent healthy-ish one as last resort
    // rather than returning zero fallbacks and immediately failing with
    // AI_ALL_PROVIDERS_FAILED while providers might have recovered.
    if (fallbacks.length === 0 && skippedDueToHealth.length > 0) {
        const lastResort = skippedDueToHealth[0];
        const provider = inferProvider(lastResort);
        // Only use as last resort if it's not permanently unconfigured (has API key)
        if (isConfigured(provider)) {
            fallbacks.push(resolveModel(task, lastResort, { fallbackIndex: idx++ }));
        }
    }
    return { primary, fallbacks };
}

/** Every configured model (used by the GET /api/ai/models endpoint). */
function listConfiguredModels() {
    const models = [];
    if (isConfigured('nvidia')) {
        const isDeepSeek = AI_MODELS.nvidia.default.includes('deepseek');
        models.push({
            id: AI_MODELS.nvidia.default,
            provider: 'nvidia',
            label: isDeepSeek ? 'DeepSeek V4 Flash (NVIDIA - Premium Efficient)' : 'Nemotron 3 Super 120B (NVIDIA)',
            primary: true,
        });
    }
    if (isConfigured('groq')) {
        models.push(
            { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)' },
            { id: 'openai/gpt-oss-20b', provider: 'groq', label: 'GPT-OSS 20B (Groq)' },
            { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B (Groq)' },
            { id: 'allam-2-7b', provider: 'groq', label: 'Allam 2 7B (Groq)' },
        );
    }
    if (isConfigured('openrouter')) {
        for (const id of AI_MODELS.openRouter.fallbacks) {
            models.push({ id: `${OR_PREFIX}${id}`, provider: 'openrouter', label: id });
        }
    }
    if (isConfigured('huggingface')) {
        models.push({
            id: `${HF_PREFIX}${AI_MODELS.huggingFace.defaultModel}`,
            provider: 'huggingface',
            label: AI_MODELS.huggingFace.defaultModel,
        });
    }
    if (isConfigured('kilocode')) {
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
    inferProvider,
    stripPrefixes,
    providerCapabilities,
    resolveModel,
    buildRoutingPlan,
    configuredFallbackModels,
    listConfiguredModels,
};