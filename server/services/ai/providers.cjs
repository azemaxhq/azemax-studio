const { AI_MODELS, CORS_ORIGIN } = require('../../config/index.cjs');

const OR_PREFIX = 'or:';
const HF_PREFIX = 'hf:';

function stripORPrefix(model) {
    return model.startsWith(OR_PREFIX) ? model.slice(OR_PREFIX.length) : model;
}

function stripHFPrefix(model) {
    return model.startsWith(HF_PREFIX) ? model.slice(HF_PREFIX.length) : model;
}

function isORModel(model) {
    return model.startsWith(OR_PREFIX);
}

function isHFModel(model) {
    return model.startsWith(HF_PREFIX);
}

function getMaxTokens(responseLength = 'medium') {
    switch (responseLength) {
        case 'short': return 500;
        case 'long': return 3000;
        default: return 1500;
    }
}

const GROQ_MODEL_IDS = new Set([
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
]);

function inferProvider(model) {
    if (!model) return 'groq';
    if (isHFModel(model)) return 'huggingface';
    if (isORModel(model)) return 'openrouter';
    if (GROQ_MODEL_IDS.has(model) || model.includes('llama') || model.includes('mixtral') || model.includes('gemma')) {
        return 'groq';
    }
    if (model.includes('/')) return 'openrouter';
    return 'groq';
}

async function chatCompletion({ provider, model, messages, temperature = 0.7, maxTokens = 1500, stream = false }) {
    let url;
    let apiKey;
    const resolvedProvider = provider || inferProvider(model);

    let resolvedModel = model;
    if (resolvedProvider === 'groq') {
        url = 'https://api.groq.com/openai/v1/chat/completions';
        apiKey = AI_MODELS.groq.apiKey;
        resolvedModel = stripORPrefix(stripHFPrefix(model || AI_MODELS.groq.default));
    } else if (resolvedProvider === 'openrouter') {
        url = AI_MODELS.openRouter.baseUrl;
        apiKey = AI_MODELS.openRouter.apiKey;
        resolvedModel = stripORPrefix(model || 'openrouter/free');
    } else if (resolvedProvider === 'huggingface') {
        url = AI_MODELS.huggingFace.baseUrl;
        apiKey = AI_MODELS.huggingFace.apiKey;
        resolvedModel = stripHFPrefix(model || AI_MODELS.huggingFace.defaultModel);
        stream = false;
    } else {
        throw new Error(`Unknown provider: ${resolvedProvider}`);
    }

    if (!apiKey) {
        const err = new Error(`${resolvedProvider} API key is not configured on the server`);
        err.status = 503;
        throw err;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': CORS_ORIGIN,
            'X-Title': 'AI Code Editor',
        },
        body: JSON.stringify({
            model: resolvedModel,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        const err = new Error(`${resolvedProvider} request failed: ${response.status}`);
        err.status = response.status;
        err.details = text;
        throw err;
    }

    return response;
}

function listModels() {
    const models = [];

    if (AI_MODELS.groq.apiKey) {
        models.push(
            { id: 'llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B (Groq)' },
            { id: 'llama-3.1-8b-instant', provider: 'groq', label: 'Llama 3.1 8B Instant (Groq)' },
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

    return models;
}

module.exports = {
    OR_PREFIX,
    HF_PREFIX,
    isORModel,
    isHFModel,
    stripORPrefix,
    stripHFPrefix,
    inferProvider,
    getMaxTokens,
    chatCompletion,
    listModels,
};
