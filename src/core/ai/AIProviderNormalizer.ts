/**
 * Provider normalization layer — converts provider-specific responses into the
 * canonical `AIResponse` type. The rest of the application must not care which
 * provider produced the response.
 *
 * Responsibilities:
 *   - Extract visible content from provider deltas
 *   - Discard reasoning content (reasoning_content, thinking blocks, etc.)
 *   - Normalize provider-specific delta formats
 *   - Capture usage metadata
 *   - Preserve finish reason
 *   - Identify provider/model
 *   - Return canonical AIResponse
 */

import type { AIResponse, AIUsage, AIStreamEvent } from './types';

export interface ProviderDelta {
    content?: string;
    reasoning_content?: string;
    finish_reason?: string | null;
}

/**
 * Normalizes a single provider stream chunk into visible content only.
 * Returns the visible content to forward to the UI, or null if the chunk
 * contains only reasoning.
 */
export function normalizeProviderStreamChunk(
    delta: ProviderDelta
): { visibleContent: string | null; reasoningContent: string | null } {
    let visibleContent: string | null = null;
    let reasoningContent: string | null = null;

    if (delta.reasoning_content) {
        reasoningContent = delta.reasoning_content;
    }

    if (delta.content) {
        visibleContent = delta.content;
    }

    return { visibleContent, reasoningContent };
}

/**
 * Normalizes a complete non-streaming provider response into the canonical
 * AIResponse type.
 */
export function normalizeAIResponse(
    provider: string,
    model: string,
    response: {
        choices?: Array<{
            message?: { content?: string; reasoning_content?: string };
            finish_reason?: string | null;
        }>;
        usage?: AIUsage;
    }
): AIResponse {
    const choice = response.choices?.[0];
    const message = choice?.message;

    // Only the visible content goes into the response
    const content = message?.content || '';

    // Reasoning content is captured internally but NOT included in the response
    // const reasoningContent = message?.reasoning_content;

    return {
        content,
        usage: response.usage
            ? {
                  promptTokens: response.usage.prompt_tokens,
                  completionTokens: response.usage.completion_tokens,
                  totalTokens: response.usage.total_tokens,
              }
            : undefined,
        finishReason: choice?.finish_reason || undefined,
        provider,
        model,
    };
}

/**
 * Creates an AIResponse from a streamed completion (accumulated chunks).
 */
export function createAIResponseFromStream(
    provider: string,
    model: string,
    accumulatedContent: string,
    usage?: AIUsage,
    finishReason?: string
): AIResponse {
    return {
        content: accumulatedContent,
        usage: usage
            ? {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                  totalTokens: usage.total_tokens,
              }
            : undefined,
        finishReason,
        provider,
        model,
    };
}

/**
 * Normalizes a provider stream event into the internal AIStreamEvent.
 * This is used by the direct provider path (OpenAI-compatible).
 */
export function normalizeProviderStreamEvent(
    provider: string,
    model: string,
    event: {
        type: 'delta' | 'reasoning' | 'done' | 'error';
        content?: string;
        reasoning_content?: string;
        usage?: AIUsage;
        finish_reason?: string | null;
        error?: { message: string; code?: string; retryable?: boolean };
    }
): AIStreamEvent {
    switch (event.type) {
        case 'delta':
            if (event.content) {
                return { type: 'delta', content: event.content };
            }
            return { type: 'delta', content: '' };
        case 'reasoning':
            if (event.reasoning_content) {
                return { type: 'reasoning', content: event.reasoning_content };
            }
            return { type: 'reasoning', content: '' };
        case 'done':
            return {
                type: 'done',
                model,
                usage: event.usage,
            };
        case 'error':
            return {
                type: 'error',
                message: event.error?.message || 'Provider error',
                code: event.error?.code,
                provider,
                retryable: event.error?.retryable,
            };
        default:
            return { type: 'delta', content: '' };
    }
}