const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const PISTON_API = 'https://emkc.org/api/v2/piston';

// OpenRouter API configuration (LiteLLM-compatible)
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';

// Models to try in order (fallback chain) - using free models
// Using multiple providers for better rate limit handling
const AI_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'liquid/lfm-2.5-1.2b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'qwen/qwen3-coder:free'
];

// AI Chat endpoint (LiteLLM/OpenRouter compatible)
app.post('/api/ai/chat', async (req, res) => {
    console.log('[AI] /api/ai/chat called');

    const { messages, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
    }

    // Try models in order until one works
    const modelsToTry = model ? [model] : AI_MODELS;
    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            console.log(`[AI] Trying model: ${currentModel}`);

            const response = await fetch(OPENROUTER_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'http://localhost:5173',
                    'X-Title': 'AI Code Editor'
                },
                body: JSON.stringify({
                    model: currentModel,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[AI] ${currentModel} failed with status ${response.status}:`, errorText);
                lastError = `${currentModel}: ${response.status} - ${errorText}`;
                continue; // Try next model
            }

            const data = await response.json();
            console.log('[AI] Success! Response received');

            // Return in OpenAI-compatible format
            return res.json(data);

        } catch (error) {
            console.error(`[AI] ${currentModel} error:`, error.message);
            lastError = error.message;
            continue; // Try next model
        }
    }

    // All models failed
    console.error('[AI] All models failed. Last error:', lastError);
    res.status(500).json({
        error: 'All AI models failed',
        details: lastError
    });
});

// Proxy to Piston Runtimes
app.get('/api/runtimes', async (req, res) => {
    try {
        const response = await fetch(`${PISTON_API}/runtimes`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Failed to fetch runtimes:', error);
        res.status(500).json({ error: 'Failed to fetch runtimes' });
    }
});

// Proxy to Piston Execute
app.post('/api/execute', async (req, res) => {
    console.log('[API] /api/execute called');
    try {
        const { language, version, files, stdin, args, compile_timeout, run_timeout, memory_limit } = req.body;
        console.log(`[API] Executing ${language}...`);

        const response = await fetch(`${PISTON_API}/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                language,
                version,
                files,
                stdin,
                args,
                compile_timeout: compile_timeout || 10000,
                run_timeout: run_timeout || 3000,
                memory_limit: memory_limit || 1024 * 1024 * 100, // 100MB
            }),
        });

        const data = await response.json();
        console.log('[API] Piston response:', JSON.stringify(data).substring(0, 50) + '...');
        res.json(data);
    } catch (error) {
        console.error('Failed to execute code:', error);
        res.status(500).json({ error: 'Failed to execute code' });
    }
});

app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    if (!OPENROUTER_API_KEY) {
        console.warn('[WARN] OPENROUTER_API_KEY not set! AI features will not work.');
        console.warn('[WARN] Get a free key at https://openrouter.ai/keys');
    }
});
