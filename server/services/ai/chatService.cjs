const { AI_MODELS } = require('../../config/index.cjs');
const {
    inferProvider,
    getMaxTokens,
    chatCompletion,
    listModels,
} = require('./providers.cjs');

function cleanResponse(content) {
    let cleaned = content;
    cleaned = cleaned.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
    const codeBlockMatch = cleaned.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[2];
    } else {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim() || content.trim();
}

function resolveProvider(model) {
    return { provider: inferProvider(model), model };
}

function buildFallbackChain(requestedModel) {
    const chain = [requestedModel || AI_MODELS.groq.default];

    const groqDefault = AI_MODELS.groq.default;
    if (!chain.includes(groqDefault) && AI_MODELS.groq.apiKey) {
        chain.push(groqDefault);
    }

    const orFree = 'or:openrouter/free';
    if (!chain.includes(orFree) && AI_MODELS.openRouter.apiKey) {
        chain.push(orFree);
    }

    return chain;
}

async function sendChat({ messages, model, temperature, responseLength = 'medium' }) {
    const modelsToTry = buildFallbackChain(model);
    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            const { provider, model: resolved } = resolveProvider(currentModel);
            const response = await chatCompletion({
                provider,
                model: resolved,
                messages,
                temperature: temperature ?? 0.7,
                maxTokens: getMaxTokens(responseLength),
                stream: false,
            });

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            return {
                content: cleanResponse(content),
                model: currentModel,
                usage: data.usage,
            };
        } catch (err) {
            console.warn(`[AI] Model ${currentModel} failed:`, err.message);
            lastError = err;
        }
    }

    const error = new Error('All AI models in the fallback chain failed');
    error.status = 503;
    error.details = lastError?.details || lastError?.message;
    throw error;
}

function writeSse(res, payload) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
}

async function pipeProviderStream(response, res) {
    if (!response.body) {
        throw new Error('Provider returned no response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokenCount = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') return tokenCount;

            try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta?.content
                    ?? parsed.choices?.[0]?.message?.content;
                if (delta) {
                    writeSse(res, { type: 'token', content: delta });
                    tokenCount += 1;
                }
            } catch {
                /* ignore partial SSE chunks */
            }
        }
    }

    return tokenCount;
}

async function streamChat({ messages, model, temperature, responseLength = 'medium', res }) {
    const modelsToTry = buildFallbackChain(model);
    let lastError = null;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    for (const currentModel of modelsToTry) {
        try {
            const { provider, model: resolved } = resolveProvider(currentModel);
            writeSse(res, { type: 'model', model: currentModel });

            const response = await chatCompletion({
                provider,
                model: resolved,
                messages,
                temperature: temperature ?? 0.7,
                maxTokens: getMaxTokens(responseLength),
                stream: true,
            });

            const tokenCount = await pipeProviderStream(response, res);
            if (tokenCount > 0) {
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }

            throw new Error('Provider stream returned no tokens');
        } catch (err) {
            console.warn(`[AI] Stream model ${currentModel} failed:`, err.message);
            lastError = err;
        }
    }

    // Fallback: non-streaming completion, then emit as one SSE payload
    for (const currentModel of modelsToTry) {
        try {
            const result = await sendChat({
                messages,
                model: currentModel,
                temperature,
                responseLength,
            });
            writeSse(res, { type: 'model', model: result.model });
            writeSse(res, { type: 'token', content: result.content });
            res.write('data: [DONE]\n\n');
            res.end();
            return;
        } catch (err) {
            console.warn(`[AI] Non-stream fallback ${currentModel} failed:`, err.message);
            lastError = err;
        }
    }

    writeSse(res, {
        type: 'error',
        message: lastError?.message || 'All AI models failed',
        details: lastError?.details,
    });
    res.end();
}

/** OpenAI-compatible passthrough for legacy clients */
async function proxyOpenRouter({ messages, model }) {
    const modelsToTry = model ? [model] : AI_MODELS.openRouter.fallbacks;
    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            const response = await chatCompletion({
                provider: 'openrouter',
                model: currentModel,
                messages,
                temperature: 0.1,
                maxTokens: 2000,
                stream: false,
            });
            return response.json();
        } catch (err) {
            lastError = err;
        }
    }

    const error = new Error('All AI models failed');
    error.status = 500;
    error.details = lastError?.details;
    throw error;
}

module.exports = {
    sendChat,
    streamChat,
    proxyOpenRouter,
    listModels,
    cleanResponse,
};
