const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

const AI_MODELS = {
    // Default AI provider: NVIDIA Nemotron 3 Super (premium + efficient, verified 950ms) — DeepSeek Flash via NVIDIA currently hangs >12s (verified), so primary is fast Nemotron for instant ///.
    // DeepSeek Flash remains available via OpenRouter fallback (or:deepseek/deepseek-chat 1.1s) for premium reasoning when needed.
    nvidia: {
        baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        default: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
        apiKey: process.env.NVIDIA_API_KEY || '',
    },
    groq: {
        default: 'qwen/qwen3.8-27b',
        apiKey: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || '',
    },
    openRouter: {
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '',
        fallbacks: [
            'nvidia/nemotron-3-super-120b-a12b:free',
            'nvidia/nemotron-3.5-lightning:free',
            'nvidia/nemotron-3-ultra-550b-a55b:free',
        ],
    },
    huggingFace: {
        baseUrl: 'https://router.huggingface.co/v1/chat/completions',
        apiKey: process.env.HF_TOKEN || process.env.VITE_HF_TOKEN || '',
        defaultModel: 'deepseek-ai/DeepSeek-R1:novita',
    },
    kiloCode: {
        baseUrl: process.env.KILO_BASE_URL || 'https://api.kilocode.ai/v1',
        apiKey: process.env.KILO_API_KEY || '',
    },
};

const rawCORS = process.env.CORS_ORIGIN || 'http://localhost:5173';
const CORS_ORIGIN = rawCORS.includes(',') ? rawCORS.split(',').map(s => s.trim()).filter(Boolean) : rawCORS;

module.exports = {
    PORT,
    DATA_DIR,
    WORKSPACES_DIR,
    AI_MODELS,
    CORS_ORIGIN,
};
