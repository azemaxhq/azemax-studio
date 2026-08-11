const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');

const AI_MODELS = {
    groq: {
        default: 'llama-3.3-70b-versatile',
        apiKey: process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY || '',
    },
    openRouter: {
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '',
        fallbacks: [
            'openrouter/free',
            'qwen/qwen3-coder:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'google/gemini-2.0-flash-exp:free',
        ],
    },
    huggingFace: {
        baseUrl: 'https://router.huggingface.co/v1/chat/completions',
        apiKey: process.env.HF_TOKEN || process.env.VITE_HF_TOKEN || '',
        defaultModel: 'deepseek-ai/DeepSeek-R1:novita',
    },
};

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

module.exports = {
    PORT,
    DATA_DIR,
    WORKSPACES_DIR,
    AI_MODELS,
    CORS_ORIGIN,
};
