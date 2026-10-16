/**
 * AIError taxonomy for the AI runtime.
 *
 * Every provider failure is normalized into a typed `AIError` BEFORE it can
 * influence fallback, chat output, or editor application. Errors are never
 * returned as generated content: only the structured error object (code,
 * provider, model, retryable, latency) crosses the transport boundary.
 *
 * Serialization (`toJSON`) is deliberately minimal — no secrets, no stack
 * traces, no internal `details` leak to the client. `userMessage` is the only
 * human-readable text exposed to the UI.
 */

const AI_ERROR_CODES = {
    AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
    AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
    AI_PROVIDER_RATE_LIMITED: 'AI_PROVIDER_RATE_LIMITED',
    AI_PROVIDER_AUTH_ERROR: 'AI_PROVIDER_AUTH_ERROR',
    AI_PROVIDER_BAD_REQUEST: 'AI_PROVIDER_BAD_REQUEST',
    AI_PROVIDER_SERVER_ERROR: 'AI_PROVIDER_SERVER_ERROR',
    AI_PROVIDER_CONFIG_ERROR: 'AI_PROVIDER_CONFIG_ERROR',
    AI_REQUEST_ABORTED: 'AI_REQUEST_ABORTED',
    AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
    AI_ALL_PROVIDERS_FAILED: 'AI_ALL_PROVIDERS_FAILED',
};

class AIError extends Error {
    /**
     * @param {object} input
     * @param {string} input.code         one of AI_ERROR_CODES
     * @param {string} [input.provider]   provider id (nvidia / groq / openrouter / huggingface)
     * @param {string} [input.model]      model id that failed
     * @param {number} [input.status]     HTTP status when applicable
     * @param {boolean} [input.retryable] true when a fallback attempt is allowed
     * @param {string} [input.message]    developer message (never shown to users verbatim)
     * @param {unknown} [input.cause]     original error
     * @param {number} [input.latencyMs]  ms spent on the failed attempt
     * @param {string} [input.requestId]  correlation id
     * @param {unknown} [input.details]   internal detail (never serialized)
     */
    constructor({
        code,
        provider,
        model,
        status,
        retryable = false,
        message,
        cause,
        latencyMs,
        requestId,
        details,
    }) {
        super(message || code);
        this.name = 'AIError';
        this.code = code || AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE;
        this.provider = provider || null;
        this.model = model || null;
        this.status = status || null;
        this.retryable = Boolean(retryable);
        this.cause = cause || null;
        this.latencyMs = latencyMs || null;
        this.requestId = requestId || null;
        this.details = details === undefined ? null : details;
    }

    /** Minimal wire representation. Never includes secrets, stacks, or details. */
    toJSON() {
        return {
            code: this.code,
            userMessage: aiErrorToUserMessage(this),
            provider: this.provider,
            model: this.model,
            status: this.status,
            retryable: this.retryable,
            latencyMs: this.latencyMs,
            requestId: this.requestId,
        };
    }
}

function aiErrorToUserMessage(err) {
    if (!err || !err.code) return 'AI is temporarily unavailable. Please try again.';
    switch (err.code) {
        case AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED:
            return 'AI is temporarily unavailable. Please try again.';
        case AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR:
            return 'AI provider authentication failed. Check the provider API key configuration.';
        case AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR:
            return 'AI provider is not configured. Add the provider API key to run AI features.';
        case AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED:
            return 'AI provider is rate limited. Please try again shortly.';
        case AI_ERROR_CODES.AI_PROVIDER_TIMEOUT:
            return 'AI provider timed out. Please try again.';
        case AI_ERROR_CODES.AI_REQUEST_ABORTED:
            return 'Request was cancelled.';
        case AI_ERROR_CODES.AI_INVALID_RESPONSE:
            return 'AI returned an empty response. Please try again.';
        default:
            return 'AI is temporarily unavailable. Please try again.';
    }
}

/** True when a thrown error represents a user/client-side cancellation. */
function isAbortError(err) {
    if (!err) return false;
    if (err instanceof AIError && err.code === AI_ERROR_CODES.AI_REQUEST_ABORTED) return true;
    if (err && err.name === 'AbortError') return true;
    return /abort/i.test(String(err && err.message ? err.message : ''));
}

/**
 * Classifies a raw provider failure into a typed AIError. Deterministic, status
 * driven, with transport-level heuristics for the status-less cases.
 */
function classifyProviderError({ provider, model, status, message, cause, latencyMs, requestId }) {
    if (isAbortError(cause) || isAbortError({ name: '', message: message || '' })) {
        // Provider timeout / idle abort should fallback to next provider (premium efficient)
        // User-cancelled aborts are handled separately via isAbortError checks in chatService
        const isTimeout = /timeout|timed out|deadline/i.test(String(message || '') + String(cause && cause.message ? cause.message : ''));
        return new AIError({
            code: isTimeout ? AI_ERROR_CODES.AI_PROVIDER_TIMEOUT : AI_ERROR_CODES.AI_REQUEST_ABORTED,
            provider,
            model,
            retryable: true,
            message: isTimeout ? `${provider} timed out` : 'Request aborted',
            cause,
            latencyMs,
            requestId,
        });
    }

    const msg = String(message || (cause && cause.message) || '');
    const statusNum = Number(status) || (cause && cause.status) || 0;

    if (statusNum >= 100 && statusNum < 500) {
        if (statusNum === 401 || statusNum === 403) {
            return new AIError({
                code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
                provider, model, status: statusNum, retryable: false,
                message: `${provider} authentication failed (HTTP ${statusNum})`,
                cause, latencyMs, requestId,
            });
        }
        if (statusNum === 400 || statusNum === 404 || statusNum === 410 || statusNum === 422) {
            // 404/410 (unknown/retired/EOL model id) must fall back to the next provider:
            // a single stale model string must never doom the whole chain.
            // 400/422 (malformed request) stay terminal — retrying elsewhere won't help.
            const isNotFound = statusNum === 404 || statusNum === 410;
            return new AIError({
                code: AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST,
                provider, model, status: statusNum, retryable: isNotFound ? true : false,
                message: `${provider} rejected the request (HTTP ${statusNum})`,
                cause, latencyMs, requestId,
            });
        }
        if (statusNum === 408 || statusNum === 429) {
            return new AIError({
                code: statusNum === 429
                    ? AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED
                    : AI_ERROR_CODES.AI_PROVIDER_TIMEOUT,
                provider, model, status: statusNum, retryable: true,
                message: `${provider} rate limited/timeout (HTTP ${statusNum})`,
                cause, latencyMs, requestId,
            });
        }
        if (statusNum >= 500) {
            return new AIError({
                code: AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
                provider, model, status: statusNum, retryable: true,
                message: `${provider} server error (HTTP ${statusNum})`,
                cause, latencyMs, requestId,
            });
        }
        return new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            provider, model, status: statusNum, retryable: true,
            message: `${provider} request failed (HTTP ${statusNum})`,
            cause, latencyMs, requestId,
        });
    }

    if (statusNum >= 500) {
        return new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
            provider, model, status: statusNum, retryable: true,
            message: `${provider} server error (HTTP ${statusNum})`,
            cause, latencyMs, requestId,
        });
    }

    // Status-less failures are transport level (network refused, DNS, reset).
    if (/timeout|timed out|deadline/i.test(msg)) {
        return new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_TIMEOUT,
            provider, model, retryable: true,
            message: `${provider} timed out`,
            cause, latencyMs, requestId,
        });
    }
    return new AIError({
        code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
        provider, model, retryable: true,
        message: `${provider} unavailable`,
        cause, latencyMs, requestId,
    });
}

/** Builds the final AIAllProvidersFailed error from per-attempt failures. */
function allProvidersFailed(attempts, { requestId } = {}) {
    const err = new AIError({
        code: AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
        retryable: false,
        message: 'All AI providers failed',
        requestId,
        details: { attempts },
    });
    return err;
}

/** AIError for an empty/invalid provider response (no choices, no content). */
function invalidResponse({ provider, model, message, latencyMs, requestId }) {
    return new AIError({
        code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
        provider, model, retryable: false,
        message: message || `${provider} returned an invalid/empty response`,
        latencyMs, requestId,
    });
}

module.exports = {
    AI_ERROR_CODES,
    AIError,
    aiErrorToUserMessage,
    classifyProviderError,
    allProvidersFailed,
    invalidResponse,
    isAbortError,
};