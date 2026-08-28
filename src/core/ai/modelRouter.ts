/**
 * Client-side model router — mirrors server/services/ai/modelRouter.cjs.
 *
 * The client NEVER calls NVIDIA directly (its key stays on the server); the
 * backend owns the primary Nemotron route. This router therefore:
 *   1. resolves the effective model/metadata for a task (shared with the
 *      backend's per-task reasoning profile), and
 *   2. builds the DIRECT fallback chain from the directly-configured providers
 *      only (Groq / OpenRouter / HuggingFace via VITE keys) — NVIDIA never
 *      appears in a direct chain.
 */

import { getTaskConfig } from './taskConfigClient';
import { DEFAULT_MODEL } from './AIContextBuilder';
import type { AiTaskKey } from './types';

export const OR_PREFIX = 'or:';
export const HF_PREFIX = 'hf:';
export const KILO_PREFIX = 'kilo:';

export type ProviderId = 'nvidia' | 'groq' | 'openrouter' | 'huggingface' | 'kilocode';

export interface ProviderCapabilities {
    supportsStreaming: boolean;
    supportsChatTemplateKwargs: boolean;
    supportsForceNonempty: boolean;
    supportsReasoning: boolean;
}

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
    nvidia: {
        supportsStreaming: true,
        supportsChatTemplateKwargs: true,
        supportsForceNonempty: true,
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

export interface ResolvedModel {
    provider: ProviderId;
    model: string;
    task: string;
    reasoningMode: 'off' | 'low' | 'high';
    maxTokens: number;
    temperature: number;
    capabilities: ProviderCapabilities;
    fallbackIndex: number;
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

export function stripPrefixes(model: string): string {
    let m = model || '';
    if (m.startsWith(OR_PREFIX)) m = m.slice(OR_PREFIX.length);
    if (m.startsWith(HF_PREFIX)) m = m.slice(HF_PREFIX.length);
    if (m.startsWith(KILO_PREFIX)) m = m.slice(KILO_PREFIX.length);
    return m;
}

export function inferProvider(model: string): ProviderId {
    if (!model) return 'nvidia';
    if (model.startsWith(HF_PREFIX)) return 'huggingface';
    if (model.startsWith(OR_PREFIX)) return 'openrouter';
    if (model.startsWith(KILO_PREFIX)) return 'kilocode';
    if (model.startsWith('nvidia/') || model === DEFAULT_MODEL) return 'nvidia';
    if (model === 'deepseek-ai/deepseek-v4-flash-0731' || model.startsWith('deepseek-ai/')) return 'nvidia';
    if (GROQ_MODEL_IDS.has(model)) return 'groq';
    if (KILO_MODEL_IDS.has(model)) return 'kilocode';
    if (model.includes('/')) return 'openrouter';
    return 'groq';
}

/** Directly-configured providers (VITE keys), in fallback order. */
export function configuredDirectProviders(): ProviderId[] {
    const list: ProviderId[] = [];
    if (import.meta.env?.VITE_GROQ_API_KEY) list.push('groq');
    if (import.meta.env?.VITE_OPENROUTER_API_KEY) list.push('openrouter');
    if (import.meta.env?.VITE_HF_TOKEN) list.push('huggingface');
    if (import.meta.env?.VITE_KILO_API_KEY) list.push('kilocode');
    return list;
}

/** Default model id for a direct provider (matches the backend AI_MODELS). */
export function defaultModelFor(provider: ProviderId): string {
    switch (provider) {
        case 'groq':
            return 'qwen/qwen3.6-27b';
        case 'openrouter':
            return `${OR_PREFIX}openrouter/free`;
        case 'huggingface':
            return `${HF_PREFIX}deepseek-ai/DeepSeek-R1:novita`;
        case 'kilocode':
            return `${KILO_PREFIX}nemotron-3-super`;
        default:
            return DEFAULT_MODEL;
    }
}

/** Resolves the effective model metadata for a task (shared routing policy). */
export function resolveModel(task: AiTaskKey, modelString: string): ResolvedModel {
    const profile = getTaskConfig(task);
    const provider = inferProvider(modelString);
    const model = stripPrefixes(modelString || DEFAULT_MODEL);
    const capabilities = PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.nvidia;

    return {
        provider,
        model,
        task,
        reasoningMode: (profile.reasoningMode || 'off') as ResolvedModel['reasoningMode'],
        maxTokens: profile.maxTokens,
        temperature: profile.temperature,
        capabilities,
        fallbackIndex: 0,
    };
}

/**
 * Ordered DIRECT fallback chain (backend-disabled path). NVIDIA is never in
 * this chain — the client cannot call it directly. When the requested model is
 * the NVIDIA default, the first configured direct provider's default is used.
 */
export function buildDirectChain(
    _task: AiTaskKey,
    requestedModel?: string,
    { allowFallback = true }: { allowFallback?: boolean } = {},
): string[] {
    const direct = configuredDirectProviders();
    const chain: string[] = [];

    const primary = requestedModel || defaultModelFor(direct[0] || 'groq');
    if (inferProvider(primary) !== 'nvidia') {
        chain.push(primary);
    } else if (direct.length > 0) {
        chain.push(defaultModelFor(direct[0]));
    }

    if (!allowFallback) return chain;

    for (const p of direct) {
        const m = defaultModelFor(p);
        if (!chain.includes(m)) chain.push(m);
    }
    return chain;
}