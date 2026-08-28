import type { AIStreamEvent, AIUsage } from './types';
import { AIError, AI_ERROR_CODES, aiErrorToUserMessage } from './AIError';
import type { AIErrorCode } from './AIError';

/**
 * The single SSE stream parser + frame-coalesced render buffer for the AI
 * runtime. Every streaming feature consumes provider deltas through this module —
 * there is no second streaming implementation.
 *
 * `AIStreamBuffer` coalesces incoming deltas to at most one callback per
 * animation frame (frame-scheduled batching, never an artificial delay).
 */

interface RawSseBlock {
    payload?: unknown;
    done?: boolean;
}

/**
 * Low-level SSE reader: yields one block per `data:` line. Handles CRLF,
 * partial chunk boundaries, and the OpenAI `[DONE]` sentinel. If `signal`
 * aborts, the read loop stops and the underlying reader is cancelled.
 */
export async function* parseSseBlocks(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<RawSseBlock, void, unknown> {
    if (!response.body) throw new Error('AI stream returned an empty response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const onAbort = () => {
        reader.cancel().catch(() => {});
    };
    if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
        while (true) {
            // Propagate cancellation as a proper AbortError so callers never
            // mistake a user-cancelled stream for a provider failure (which
            // would trigger a wasteful fallback re-request).
            if (signal?.aborted) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            const { done, value } = await reader.read();
            // `reader.cancel()` resolves a pending read as `done:true`; if that
            // was caused by an abort, surface it as AbortError rather than
            // letting the caller misread it as a clean, content-less end.
            if (signal?.aborted) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') {
                    yield { done: true };
                    return;
                }
                try {
                    yield { payload: JSON.parse(payload) };
                } catch {
                    // ignore malformed/partial event
                }
            }
        }
    } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        try {
            if (!signal?.aborted) reader.cancel().catch(() => {});
        } catch { /* already closed */ }
    }
}

interface BackendSseEvent {
    type?: string;
    content?: string;
    message?: string;
    details?: string;
    model?: string;
    provider?: string;
    code?: string;
    retryable?: boolean;
    usage?: AIUsage;
}

/**
 * Maps the backend SSE event shape ({type:'start'|'model'|'token'|'done'|'error'})
 * to normalized `AIStreamEvent`s. Backend `error` events carry a typed
 * `AI_ERROR_CODES` value (never the raw developer message) and surface as a
 * typed `AIError` so fallback and display logic can branch on the code.
 */
export async function* streamFromBackend(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    let sawContent = false;
    for await (const block of parseSseBlocks(response, signal)) {
        if (block.done) {
            if (!sawContent) throw new Error('AI stream ended without any content');
            return;
        }
        const event = block.payload as BackendSseEvent;
        if (!event) continue;
        switch (event.type) {
            case 'start':
                yield { type: 'start', model: event.model || '' };
                break;
            case 'model':
                yield { type: 'model', model: event.model || '' };
                break;
            case 'token':
                if (event.content) {
                    sawContent = true;
                    yield { type: 'delta', content: event.content };
                }
                break;
            case 'done':
                if (!sawContent) throw new Error('AI stream ended without any content');
                yield { type: 'done', model: event.model, usage: event.usage };
                return;
            case 'error': {
                const err = new AIError({
                    code: (event.code as AIErrorCode | undefined) || AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED,
                    provider: event.provider,
                    model: event.model,
                    retryable: Boolean(event.retryable),
                    message: event.message || 'AI request failed',
                    details: event.details,
                });
                if (!sawContent) {
                    throw err;
                }
                // Content already streamed: surface the typed error after the
                // partial response so the caller keeps what was received.
                yield { type: 'error', message: aiErrorToUserMessage(err), details: event.details, code: err.code, provider: err.provider ?? undefined, retryable: err.retryable };
                return;
            }
            default:
                break;
        }
    }
    if (!sawContent) throw new Error('AI stream ended without any content');
}

interface OpenAIDelta {
    content?: string;
    reasoning_content?: string;
}

interface OpenAIChunk {
    choices?: Array<{ delta?: OpenAIDelta; message?: OpenAIDelta; finish_reason?: string | null }>;
    usage?: unknown;
    error?: { message?: string; type?: string };
}

/**
 * Maps a raw OpenAI-compatible SSE stream (used by the direct-provider fallback
 * path) to normalized `AIStreamEvent`s. `reasoning_content` is surfaced as a
 * separate `reasoning` event and never mixed into `delta`.
 */
export async function* streamFromOpenAI(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    for await (const block of parseSseBlocks(response, signal)) {
        if (block.done) {
            yield { type: 'done' };
            return;
        }
        const chunk = block.payload as OpenAIChunk;
        if (!chunk) continue;
        if (chunk.error?.message) {
            throw new Error(chunk.error.message);
        }
        const choice = chunk.choices?.[0];
        if (!choice) {
            if (chunk.usage) {
                yield { type: 'done', usage: chunk.usage as AIUsage };
                return;
            }
            continue;
        }
        const delta = choice.delta ?? choice.message;
        if (delta?.reasoning_content) {
            yield { type: 'reasoning', content: delta.reasoning_content };
        }
        if (delta?.content) {
            yield { type: 'delta', content: delta.content };
        }
        if (choice.finish_reason) {
            yield { type: 'done', usage: chunk.usage as AIUsage };
            return;
        }
    }
}

/**
 * Frame-coalesced streaming buffer.
 *
 * Incoming deltas are delivered to `onFrame` with these guarantees:
 *   - The FIRST token is published IMMEDIATELY (synchronously) — the first
 *     available token is never delayed behind an animation frame.
 *   - Subsequent deltas coalesce into a single `onFrame` call at most once per
 *     animation frame (frame-scheduled batching, never an artificial delay).
 *   - `flush()` delivers any pending content immediately (stop / complete), so
 *     no received token is ever lost.
 *   - `dispose()` cancels a scheduled frame and rejects further appends
 *     (abort / supersede).
 * A stale guard (`isActive`) rejects updates from superseded requests.
 */
export class AIStreamBuffer {
    private pending: string | null = null;
    private frame: number | null = null;
    private publishedOnce = false;
    private ended = false;
    private readonly onFrame: (text: string) => void;
    private readonly isActive: () => boolean;

    constructor(onFrame: (text: string) => void, isActive: () => boolean) {
        this.onFrame = onFrame;
        this.isActive = isActive;
    }

    append(text: string): void {
        if (!text || this.ended) return;
        if (!this.publishedOnce) {
            // First token: publish synchronously — no frame delay on the first
            // available content.
            this.publishedOnce = true;
            if (!this.isActive()) return;
            this.onFrame(text);
            return;
        }
        this.pending = (this.pending ?? '') + text;
        if (this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            const chunk = this.pending;
            this.pending = null;
            if (chunk === null || chunk === '') return;
            if (!this.isActive()) return;
            this.onFrame(chunk);
        });
    }

    flush(): void {
        if (this.ended) return;
        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        const chunk = this.pending;
        this.pending = null;
        if (chunk === null || chunk === '') return;
        if (!this.isActive()) return;
        this.onFrame(chunk);
    }

    dispose(): void {
        this.ended = true;
        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        this.pending = null;
    }
}