const { AI_MODELS } = require('../../config/index.cjs');

/**
 * Short-lived provider/model health cache.
 *
 * Goal: never waste seconds re-trying a provider that is *known* to be
 * unavailable (missing API key, 5xx, transport failure). Failures are cached
 * briefly; the TTL bounds the penalty so a provider that recovers is retried
 * soon. Success refreshes the entry so a healthy provider is never skipped.
 *
 * No secrets are stored — only a boolean health flag and a timestamp.
 */

const FAIL_TTL_MS = 15 * 1000;   // how long a failure stays remembered (reduced from 30s to recover faster from transient timeouts)
const OK_TTL_MS = 60 * 1000; // how long a success stays fresh (reduced from 2min for quicker re-validation)

const state = new Map(); // `${provider}:${model}` -> { ok, at }

function key(provider, model) {
    return `${String(provider || '').toLowerCase()}:${model}`;
}

/** True when the provider has a configured API key (avoids pointless attempts). */
function isConfigured(provider) {
    const p = String(provider || '').toLowerCase();
    switch (p) {
        case 'nvidia':
            return Boolean(AI_MODELS.nvidia.apiKey);
        case 'groq':
            return Boolean(AI_MODELS.groq.apiKey);
        case 'openrouter':
        case 'openRouter':
            return Boolean(AI_MODELS.openRouter.apiKey);
        case 'huggingface':
        case 'huggingFace':
            return Boolean(AI_MODELS.huggingFace.apiKey);
        case 'kilocode':
        case 'kiloCode':
            return Boolean(AI_MODELS.kiloCode?.apiKey);
        default:
            return false;
    }
}

/** Treat a provider with no API key as permanently unhealthy (until config reload). */
function isHealthy(provider, model) {
    if (!isConfigured(provider)) return false;
    const entry = state.get(key(provider, model));
    if (!entry) return true; // unknown => try
    if (entry.ok) return true; // healthy is always healthy — OK_TTL is only for metrics, not gating
    return Date.now() - entry.at >= FAIL_TTL_MS; // failed entry expired => retry
}

function markHealthy(provider, model) {
    if (!provider) return;
    state.set(key(provider, model), { ok: true, at: Date.now() });
}

function markUnhealthy(provider, model) {
    if (!provider) return;
    state.set(key(provider, model), { ok: false, at: Date.now() });
}

function clear() {
    state.clear();
}

module.exports = {
    FAIL_TTL_MS,
    OK_TTL_MS,
    isConfigured,
    isHealthy,
    markHealthy,
    markUnhealthy,
    clear,
    get size() {
        return state.size;
    },
};