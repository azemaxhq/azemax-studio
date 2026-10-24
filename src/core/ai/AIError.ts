/**
 * Client-side AIError taxonomy — mirrors server/services/ai/aiError.cjs.
 *
 * Every AI provider failure is normalized into a typed `AIError` before it can
 * influence fallback, chat output, or editor application. Provider errors are
 * NEVER returned as generated content: only the structured error object (code,
 * provider, model, retryable, latency) crosses the boundary, and the editor
 * write path refuses any `AIError` outright.
 */

import { redactSecrets, redactDeep } from './redaction';

export const AI_ERROR_CODES = {
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
} as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

export interface AIErrorInput {
    code: AIErrorCode;
    provider?: string;
    model?: string;
    status?: number;
    retryable?: boolean;
    message?: string;
    cause?: unknown;
    latencyMs?: number;
    requestId?: string;
    details?: unknown;
}

/** Minimal wire representation. Never includes secrets, stacks, or details. */
export interface AIErrorWire {
    code: AIErrorCode;
    userMessage: string;
    provider: string | null;
    model: string | null;
    status: number | null;
    retryable: boolean;
    latencyMs: number | null;
    requestId: string | null;
}

export class AIError extends Error {
    readonly code: AIErrorCode;
    readonly provider: string | null;
    readonly model: string | null;
    readonly status: number | null;
    readonly retryable: boolean;
    readonly cause: unknown;
    readonly latencyMs: number | null;
    readonly requestId: string | null;
    readonly details: unknown;

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
    }: AIErrorInput) {
        // Defense in depth: the message, cause and details are redacted here
        // so NO code path can leak a credential that a provider echoed back
        // (several providers return a masked form of the submitted key in the
        // error body). Everything downstream — logs, chat bubbles, diagnostic
        // payloads — receives the redacted form.
        super(redactSecrets(message || code));
        this.name = 'AIError';
        this.code = code || AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE;
        this.provider = provider || null;
        this.model = model || null;
        this.status = status || null;
        this.retryable = Boolean(retryable);
        this.cause = redactDeep(cause ?? null);
        this.latencyMs = latencyMs ?? null;
        this.requestId = requestId ?? null;
        this.details = details === undefined ? null : redactDeep(details);
    }

    toJSON(): AIErrorWire {
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

export function aiErrorToUserMessage(err: AIError | AIErrorWire | null | undefined): string {
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

/**
 * True when a thrown error represents a user/client-side cancellation.
 * (AIAbortController also exports an `isAbortError`; this one additionally
 * recognizes an `AIError` with code AI_REQUEST_ABORTED. It is NOT re-exported
 * from index.ts to avoid an export-name clash.)
 */
function isAbortError(err: unknown): boolean {
    if (!err) return false;
    if (err instanceof AIError && err.code === AI_ERROR_CODES.AI_REQUEST_ABORTED) return true;
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    const e = err as { name?: unknown; message?: unknown };
    if (typeof e.name === 'string' && e.name === 'AbortError') return true;
    if (typeof e.message === 'string' && /abort/i.test(e.message)) return true;
    return false;
}

/**
 * Classifies a raw provider failure into a typed AIError. Deterministic, status
 * driven, with transport-level heuristics for the status-less cases.
 */
export function classifyProviderError({
    provider,
    model,
    status,
    message,
    cause,
    latencyMs,
    requestId,
}: {
    provider?: string;
    model?: string;
    status?: number;
    message?: string;
    cause?: unknown;
    latencyMs?: number;
    requestId?: string;
}): AIError {
    if (isAbortError(cause) || isAbortError(message)) {
        return new AIError({
            code: AI_ERROR_CODES.AI_REQUEST_ABORTED,
            provider,
            model,
            retryable: false,
            message: 'Request aborted',
            cause,
            latencyMs,
            requestId,
        });
    }

    const msg = String(message || (cause && (cause as { message?: unknown }).message) || '');
    const statusNum = Number(status) || Number((cause as { status?: unknown })?.status) || 0;

    if (statusNum >= 100) {
        if (statusNum === 401 || statusNum === 403) {
            return new AIError({
                code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
                provider, model, status: statusNum, retryable: false,
                message: `${provider} authentication failed (HTTP ${statusNum})`,
                cause, latencyMs, requestId,
            });
        }
        if (statusNum === 400 || statusNum === 404 || statusNum === 422) {
            // 404 (unknown/retired model id) must fall back to the next provider:
            // a single stale model string must never doom the whole chain.
            const isNotFound = statusNum === 404;
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
        if (statusNum === 503) {
            return new AIError({
                code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
                provider, model, status: statusNum, retryable: true,
                message: `${provider} service unavailable (HTTP ${statusNum})`,
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
        // Other 1xx, 2xx, 3xx (non-standard for error responses)
        return new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            provider, model, status: statusNum, retryable: true,
            message: `${provider} request failed (HTTP ${statusNum})`,
            cause, latencyMs, requestId,
        });
    }

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
export function allProvidersFailed(
    attempts: { provider: string; model: string; retryable?: boolean }[],
    { requestId }: { requestId?: string } = {},
): AIError {
    // Determine if ANY attempt had a retryable error — if so, the whole
    // failure is transient and the client should retry the entire chain.
    const anyRetryable = attempts.some(a => a.retryable === true);
    return new AIError({
        code: AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
        retryable: anyRetryable,
        message: 'All AI providers failed',
        requestId,
        details: { attempts },
    });
}

/** AIError for an empty/invalid provider response (no choices, no content). */
export function invalidResponse({
    provider,
    model,
    message,
    latencyMs,
    requestId,
}: {
    provider?: string;
    model?: string;
    message?: string;
    latencyMs?: number;
    requestId?: string;
}): AIError {
    return new AIError({
        code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
        provider, model, retryable: false,
        message: message || `${provider} returned an invalid/empty response`,
        latencyMs, requestId,
    });
}