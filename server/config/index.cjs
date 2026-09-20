const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

// Production guard: never allow VITE_ keys to be read server-side in production.
// In production the browser must call /api/ai/* — provider keys must be server-only.
const isProd = process.env.NODE_ENV === 'production';
if (isProd && (process.env.VITE_GROQ_API_KEY || process.env.VITE_OPENROUTER_API_KEY || process.env.VITE_HF_TOKEN)) {
    console.warn('[config] VITE_ provider keys detected in production environment — ignoring. Use server-only keys (GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN).');
}

const AI_MODELS = {
    nvidia: {
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        default: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
        apiKey: process.env.NVIDIA_API_KEY || '',
    },
    groq: {
        default: 'qwen/qwen3.8-27b',
        apiKey: isProd ? (process.env.GROQ_API_KEY || '') : (process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || ''),
    },
    openRouter: {
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: isProd ? (process.env.OPENROUTER_API_KEY || '') : (process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || ''),
        fallbacks: [
            'nvidia/nemotron-3-super-120b-a12b:free',
            'nvidia/nemotron-3.5-lightning:free',
            'nvidia/nemotron-3-ultra-550b-a55b:free',
        ],
    },
    huggingFace: {
        baseUrl: 'https://router.huggingface.co/v1/chat/completions',
        apiKey: isProd ? (process.env.HF_TOKEN || '') : (process.env.HF_TOKEN || process.env.VITE_HF_TOKEN || ''),
        defaultModel: 'deepseek-ai/DeepSeek-R1:novita',
    },
    kiloCode: {
        baseUrl: process.env.KILO_BASE_URL || 'https://api.kilocode.ai/v1',
        apiKey: process.env.KILO_API_KEY || '',
    },
};

const rawCORS = process.env.CORS_ORIGIN || 'http://localhost:5173';
const CORS_ORIGIN = rawCORS.includes(',') ? rawCORS.split(',').map(s => s.trim()).filter(Boolean) : rawCORS;

// Beta safety: local execution must be explicitly allowed in production.
const ALLOW_LOCAL_EXECUTION = (() => {
    if (process.env.ALLOW_LOCAL_EXECUTION === 'true') return true;
    if (process.env.ALLOW_LOCAL_EXECUTION === 'false') return false;
    // Default: allow locally (dev/test), deny in production
    return process.env.NODE_ENV !== 'production';
})();

module.exports = {
    PORT,
    DATA_DIR,
    WORKSPACES_DIR,
    AI_MODELS,
    CORS_ORIGIN,
    ALLOW_LOCAL_EXECUTION,
};
