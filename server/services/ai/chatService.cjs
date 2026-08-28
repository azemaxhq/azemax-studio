const { AI_MODELS } = require('../../config/index.cjs');
const { chatCompletion, listModels } = require('./aiClient.cjs');
const {
    resolveTaskParams,
    cleanResponse,
    buildRoutingPlan,
} = require('./aiContext.cjs');
const { markHealthy, markUnhealthy, isHealthy, isConfigured } = require('./providerHealth.cjs');
const {
    writeSse,
    pipeProviderStream,
    createVisibleContentFilter,
} = require('./aiStream.cjs');
const {
    AIError,
    AI_ERROR_CODES,
    classifyProviderError,
    allProvidersFailed,
    invalidResponse,
    aiErrorToUserMessage,
    isAbortError,
} = require('./aiError.cjs');
const { aiRequestManager } = require('./aiRequestManager.cjs');

// Dev-only latency instrumentation. No-op in production builds.
const perfLogEnabled = process.env.NODE_ENV !== 'production';
function perfLog(...args) {
    if (perfLogEnabled) console.log('[AI perf]', ...args);
}

/** Normalizes any thrown value into a typed AIError (never a bare string). */
function toAIError(err, resolved, requestId) {
    if (err instanceof AIError) return err;
    return classifyProviderError({
        provider: resolved?.provider,
        model: resolved?.model,
        message: err && err.message,
        cause: err,
        requestId,
    });
}

async function sendChat({ messages, model, temperature, top_p, maxTokens, responseLength = 'medium', task, allowFallback = true, requestId }) {
    const params = resolveTaskParams({ task, maxTokens, temperature, top_p, responseLength });
    const plan = buildRoutingPlan(task, model, { allowFallback });
    const attempts = [plan.primary, ...plan.fallbacks];
    const rid = requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputSize = messages.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
    let lastError = null;
    const t0 = Date.now();

    console.log(`[AI CHAT] request received, intent=chat, provider attempt = ${plan.primary.provider}, model = ${plan.primary.model} requestId=${rid}`);

    if (!isConfigured(plan.primary.provider) && plan.fallbacks.length === 0) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            retryable: false,
            message: 'No AI providers are configured on the server. Add NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or HF_TOKEN to .env and restart the server. For local testing, the editor will still handle deterministic tasks like "Remove comments" offline.',
            requestId: rid,
        });
    }

    const timeoutMs = (params.task === 'complex_code' || params.task === 'deep_reasoning') ? 60000 : 30000;

    // Deadlock check: if health would skip ALL attempts, force-try the primary as last resort
    const allSkippedByHealth = attempts.every(a => !isHealthy(a.provider, a.model));
    for (let i = 0; i < attempts.length; i++) {
        const resolved = attempts[i];
        const wouldSkipForHealth = !isHealthy(resolved.provider, resolved.model);
        if (wouldSkipForHealth && !allSkippedByHealth) {
            perfLog(`task=${params.task} model=${resolved.model} skipped (unhealthy)`);
            continue;
        }
        if (wouldSkipForHealth && allSkippedByHealth && i !== 0) {
            perfLog(`task=${params.task} model=${resolved.model} skipped (unhealthy, last-resort is primary)`);
            continue;
        }
        const providerStart = Date.now();
        try {
            const response = await chatCompletion({
                provider: resolved.provider,
                model: resolved.model,
                messages,
                temperature: params.temperature,
                top_p: params.top_p,
                maxTokens: params.maxTokens,
                chatTemplateKwargs: resolved.chatTemplateKwargs,
                forceNonemptyContent: resolved.forceNonemptyContent,
                stream: false,
                requestId: rid,
                timeoutMs,
            });

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            if (!content) {
                console.warn(`[AI CHAT] provider=${resolved.provider} returned empty content`);
                throw invalidResponse({
                    provider: resolved.provider,
                    model: resolved.model,
                    latencyMs: Date.now() - providerStart,
                    requestId: rid,
                });
            }
            markHealthy(resolved.provider, resolved.model);
            console.log(`[AI CHAT] provider=${resolved.provider} model=${resolved.model} success latency=${Date.now() - t0}ms`);
            return {
                content: cleanResponse(content),
                model: resolved.model,
                provider: resolved.provider,
                usage: data.usage,
                requestId: rid,
            };
        } catch (err) {
            const aiErr = toAIError(err, resolved, rid);
            console.warn(`[AI] Model ${resolved.model} failed:`, aiErr.message);
            if (aiErr.retryable) {
                markUnhealthy(resolved.provider, resolved.model);
                lastError = aiErr;
                console.log(`[AI CHAT] fallback triggered, trying next provider`);
                continue;
            }
            
            // For non-retryable errors, don't fallback
            if (!aiErr.retryable) {
                throw aiErr;
            }
        }
    }

    console.error(`[AI CHAT] All providers failed for task=${params.task}`);
    throw allProvidersFailed(
        attempts.map((a) => ({ provider: a.provider, model: a.model })),
        { requestId: rid },
    );
}

async function streamChat({ messages, model, temperature, top_p, maxTokens, responseLength = 'medium', res, req, task, allowFallback = true }) {
    const params = resolveTaskParams({ task, maxTokens, temperature, top_p, responseLength });
    const plan = buildRoutingPlan(task, model, { allowFallback });
    const attempts = [plan.primary, ...plan.fallbacks];
    const requestId = req?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let lastError = null;
    let sawToken = false;
    const inputSize = messages.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
    const t0 = Date.now();

    console.log(`[AI CHAT] request received, intent=chat, provider attempt = ${plan.primary.provider}, model = ${plan.primary.model} streaming requestId=${requestId}`);

    if (!isConfigured(plan.primary.provider) && plan.fallbacks.length === 0) {
        // No providers configured — fail fast with actionable message, but also allow
        // the request to be handled by client-side local fallbacks for deterministic tasks.
        // We still send an SSE error so the client can display the setup hint.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        writeSse(res, {
            type: 'error',
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            message: 'No AI providers are configured on the server. Add NVIDIA_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY or HF_TOKEN to .env and restart. Deterministic tasks like "Remove comments" will still work offline.',
            retryable: false,
        });
        res.end();
        return;
    }

    const streamTimeoutMs = (params.task === 'complex_code' || params.task === 'deep_reasoning') ? 60000 : 30000;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    // Abort the in-flight upstream request as soon as the client disconnects so
    // we stop consuming tokens on a generation nobody is receiving.
    const clientController = new AbortController();
    const onClientClose = () => {
        if (!res.writableEnded && !res.destroyed) clientController.abort();
    };
    res.on('close', onClientClose);

    // Deadlock check: if health would skip all attempts, force-try primary as last resort
    const allSkippedByHealthStream = attempts.every(a => !isHealthy(a.provider, a.model));
    try {
        for (const resolved of attempts) {
            if (res.writableEnded || res.destroyed) return;

            const wouldSkipForHealth = !isHealthy(resolved.provider, resolved.model);
            if (wouldSkipForHealth && !allSkippedByHealthStream) {
                perfLog(`task=${params.task} model=${resolved.model} skipped (unhealthy)`);
                lastError = lastError || new AIError({
                    code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
                    provider: resolved.provider,
                    model: resolved.model,
                    retryable: true,
                    message: 'Provider unavailable (health cache)',
                    requestId,
                });
                continue;
            }
            if (wouldSkipForHealth && allSkippedByHealthStream && resolved !== attempts[0]) {
                perfLog(`task=${params.task} model=${resolved.model} skipped (unhealthy, last-resort is primary)`);
                lastError = lastError || new AIError({
                    code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
                    provider: resolved.provider,
                    model: resolved.model,
                    retryable: true,
                    message: 'Provider unavailable (health cache)',
                    requestId,
                });
                continue;
            }

            // Each attempt is tracked by the request manager: client-abort is
            // wired once per attempt, and the idle timer aborts the attempt if
            // no chunk arrives within STREAM_IDLE_TIMEOUT_MS.
            aiRequestManager.release(requestId);
            const attemptController = aiRequestManager.register(requestId, clientController.signal);

            try {
                writeSse(res, { type: 'start', model: resolved.model, provider: resolved.provider });
                writeSse(res, { type: 'model', model: resolved.model });

                const providerStart = Date.now();
                let firstByteAt = 0;

                // Non-streaming providers (HuggingFace) complete in one shot and
                // emit the finished answer as a single SSE payload.
                if (!resolved.capabilities.supportsStreaming) {
                    const response = await chatCompletion({
                        provider: resolved.provider,
                        model: resolved.model,
                        messages,
                        temperature: params.temperature,
                        top_p: params.top_p,
                        maxTokens: params.maxTokens,
                        chatTemplateKwargs: resolved.chatTemplateKwargs,
                        forceNonemptyContent: resolved.forceNonemptyContent,
                        stream: false,
                        requestId,
                        timeoutMs: streamTimeoutMs,
                    });
                    const data = await response.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    if (!content) {
                        throw invalidResponse({
                            provider: resolved.provider,
                            model: resolved.model,
                            latencyMs: Date.now() - providerStart,
                            requestId,
                        });
                    }
                    sawToken = true;
                    markHealthy(resolved.provider, resolved.model);
                    writeSse(res, { type: 'token', content: cleanResponse(content) });
                    if (!res.writableEnded && !res.destroyed) {
                        writeSse(res, { type: 'done', model: resolved.model, usage: data.usage });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                    perfLog(`task=${params.task} model=${resolved.model} non-stream path done in ${Date.now() - t0}ms`);
                    return;
                }

                const response = await chatCompletion({
                    provider: resolved.provider,
                    model: resolved.model,
                    messages,
                    temperature: params.temperature,
                    top_p: params.top_p,
                    maxTokens: params.maxTokens,
                    chatTemplateKwargs: resolved.chatTemplateKwargs,
                    forceNonemptyContent: resolved.forceNonemptyContent,
                    stream: true,
                    signal: attemptController.signal,
                    requestId,
                    timeoutMs: streamTimeoutMs,
                });

                const { tokenCount, usage, reasoningChars } = await pipeProviderStream(
                    response,
                    res,
                    () => aiRequestManager.touch(requestId),
                    () => {
                        // First visible content token (also marks the attempt as
                        // "already emitted" so a mid-stream failure never falls
                        // back and duplicates content).
                        sawToken = true;
                        markHealthy(resolved.provider, resolved.model);
                        perfLog(`task=${params.task} model=${resolved.model} firstVisibleToken in ${Date.now() - t0}ms (provider responded in ${Date.now() - providerStart}ms, firstByte in ${firstByteAt ? firstByteAt - providerStart : '?'}ms)`);
                    },
                    () => {
                        firstByteAt = Date.now();
                        perfLog(`task=${params.task} model=${resolved.model} firstByte in ${firstByteAt - t0}ms (provider request took ${firstByteAt - providerStart}ms)`);
                    },
                    (reasoningDelta) => {
                        // PRIVATE channel (dev observability only). Reasoning is
                        // NEVER forwarded to the client or written to the editor.
                        if (perfLogEnabled) console.log('[AI reasoning]', resolved.model, reasoningDelta.length, 'chars');
                    },
                );
                if (tokenCount > 0) {
                    if (!res.writableEnded && !res.destroyed) {
                        writeSse(res, { type: 'done', model: resolved.model, usage });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                    const duration = Date.now() - t0;
                    const tps = duration > 0 ? Math.round((tokenCount * 1000) / duration) : 0;
                    const usageLine = usage
                        ? ` usage=${usage.total_tokens ?? '?'}tok (prompt=${usage.prompt_tokens ?? '?'}, completion=${usage.completion_tokens ?? '?'}${usage.completion_tokens_details?.reasoning_tokens != null ? `, reasoning=${usage.completion_tokens_details.reasoning_tokens}` : ''})`
                        : '';
                    perfLog(`task=${params.task} model=${resolved.model} stream done in ${duration}ms input=${inputSize}chars tokens=${tokenCount} tok/s=${tps} reasoningChars=${reasoningChars}${usageLine}`);
                    return;
                }

                throw invalidResponse({
                    provider: resolved.provider,
                    model: resolved.model,
                    message: 'Provider stream returned no tokens',
                    latencyMs: Date.now() - providerStart,
                    requestId,
                });
            } catch (err) {
                const aiErr = toAIError(err, resolved, requestId);

                if (clientController.signal.aborted || isAbortError(aiErr)) {
                    // Client went away mid-stream; stop quietly without fallbacks.
                    return;
                }

                // Content already streamed: never restart the generation (that
                // would duplicate tokens the user already saw). End cleanly so
                // the partial response is preserved instead of shown as an error.
                if (sawToken) {
                    if (!res.writableEnded && !res.destroyed) {
                        writeSse(res, { type: 'done', model: resolved.model });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                    perfLog(`task=${params.task} model=${resolved.model} stream interrupted after content (kept partial, no fallback)`);
                    return;
                }

                console.warn(`[AI] Stream model ${resolved.model} failed:`, aiErr.message);

                // Definitive failures (auth / config / bad request / abort /
                // invalid response) never trigger a fallback.
                if (!aiErr.retryable) {
                    writeSse(res, {
                        type: 'error',
                        code: aiErr.code,
                        message: aiErrorToUserMessage(aiErr),
                        details: aiErr.details || null,
                        provider: resolved.provider,
                        retryable: false,
                    });
                    res.end();
                    return;
                }

                // For retryable errors (503, 502, 504, timeout), continue to fallback
                markUnhealthy(resolved.provider, resolved.model);
                lastError = aiErr;
                console.log(`[AI CHAT] fallback triggered for streaming, trying next provider`);
            } finally {
                aiRequestManager.release(requestId);
            }
        }
    } finally {
        aiRequestManager.release(requestId);
        res.removeListener('close', onClientClose);
    }

    console.error(`[AI CHAT] All providers failed for streaming task=${params.task}`);
    writeSse(res, {
        type: 'error',
        code: lastError?.code || AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
        message: aiErrorToUserMessage(lastError) || 'AI is temporarily unavailable. Please try again.',
        details: lastError?.details || null,
        retryable: false,
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

    throw allProvidersFailed(
        modelsToTry.map((m) => ({ provider: 'openrouter', model: m })),
        { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    );
}

module.exports = {
    sendChat,
    streamChat,
    proxyOpenRouter,
    listModels,
    cleanResponse,
    createVisibleContentFilter,
};