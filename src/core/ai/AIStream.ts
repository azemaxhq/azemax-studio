import type { AIStreamEvent, AIUsage, AIToolCall } from './types';
import { AIError, AI_ERROR_CODES, aiErrorToUserMessage } from './AIError';
import type { AIErrorCode } from './AIError';
import { extractToolCallsFromContent } from './toolCallNormalization';

/**
 * The single SSE stream parser + frame-coalesced render buffer for the AI
 * runtime. Every streaming feature consumes provider deltas through this module —
 * there is no second streaming implementation.
 *
 * `AIStreamBuffer` coalesces incoming deltas to at most one callback per
 * animation frame (frame-scheduled batching, never an artificial delay).
 */

/**
 * Cheap pre-check before the full JSON tool-call extraction.
 *
 * `extractToolCallsFromContent` attempts `JSON.parse` over the entire
 * accumulated content buffer. Running it on EVERY streamed token made token
 * handling O(n²) for long responses (the dominant visible-token render cost on
 * big answers). A tool-call payload can only be a complete JSON document
 * starting with `{`/`[` (optionally fenced) and ending with `}`/`]`/a closing
 * fence — anything else is prose or partially-streamed JSON and cannot extract
 * successfully, so skipping it is behavior-preserving.
 */
function mayBeToolPayload(buffer: string): boolean {
    const t = buffer.trim();
    if (!t) return false;
    if (!t.startsWith('{') && !t.startsWith('[') && !t.startsWith('```')) return false;
    const last = t[t.length - 1];
    return last === '}' || last === ']' || last === '`';
}

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
    /** Native tool calls forwarded by the backend SSE bridge. */
    tool_calls?: AIToolCall[];
}

/**
 * Maps the backend SSE event shape ({type:'start'|'model'|'token'|'done'|'error'})
 * to normalized `AIStreamEvent`s. Backend `error` events carry a typed
 * `AI_ERROR_CODES` value (never the raw developer message) and surface as a
 * typed `AIError` so fallback and display logic can branch on the code.
 *
 * Additionally, this function detects JSON-style tool-call payloads embedded
 * in backend `token` events' content and converts them to structured
 * `type: 'tool_calls'` events, so they are not rendered as ordinary assistant
 * prose. The same strict matching as `extractToolCallsFromContent` is used:
 * only complete, standalone JSON tool-call envelopes are recognized (prose,
 * code fences, and JSON examples are left untouched).
 */
export async function* streamFromBackend(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    // `sawContent` guards against empty streams. Tool calls count as a signal:
    // an agent step that only requests tools emits no visible tokens.
    let sawContent = false;
    let sawToolCalls = false;
    /** Accumulates content from `token` events so we can detect a complete
     *  JSON tool-call payload that arrived across one or more chunks. */
    let contentBuffer = '';
    /** Tracks whether we have already emitted a tool_calls event (via native
     *  `tool_calls` SSE frames or JSON extraction) so we never emit duplicates. */
    let toolCallsEmitted = false;

    /** Guarded extraction: only attempt a full parse when the buffer could still
     *  be a complete JSON tool-call payload (see `mayBeToolPayload`). */
    const tryExtract = (): AIToolCall[] | null =>
        (!toolCallsEmitted && mayBeToolPayload(contentBuffer)) ? extractToolCallsFromContent(contentBuffer) : null;

    for await (const block of parseSseBlocks(response, signal)) {
        if (block.done) {
            // Flush any pending native tool calls.
            if (!toolCallsEmitted) {
                if (sawToolCalls) {
                    // The backend already forwarded native tool_calls SSE frames.
                    // Re-yield them so the consumer sees them once.
                    // (We don't have the original array here, but the consumer
                    // should have seen them already; this is a safety net.)
                } else {
                    // Check the content buffer for a standalone JSON tool call
                    // that may have arrived in the last chunk(s).
                    const extracted = tryExtract();
                    if (extracted) {
                        yield { type: 'tool_calls', calls: extracted };
                        toolCallsEmitted = true;
                    }
                }
            }
            sawContent = true;
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
                    contentBuffer += event.content;

                    // Try to extract a complete tool-call from the accumulated
                    // content.  This handles the case where the backend streams
                    // JSON tool calls in content deltas rather than as separate
                    // 'tool_calls' SSE frames.
                    if (!toolCallsEmitted) {
                        const extracted = tryExtract();
                        if (extracted && extracted.length > 0) {
                            yield { type: 'tool_calls', calls: extracted };
                            toolCallsEmitted = true;
                            contentBuffer = '';
                        } else {
                            // Not a tool-call payload — yield as regular delta.
                            yield { type: 'delta', content: event.content };
                        }
                    }
                    // If we already emitted tool calls, skip yielding delta content
                    // to avoid duplicate display (the tool-calls event takes precedence).
                }
                break;
            case 'tool_calls':
                if (Array.isArray(event.tool_calls) && event.tool_calls.length) {
                    sawToolCalls = true;
                    // Only emit if we haven't already emitted tool calls via
                    // JSON extraction (prevents duplicate execution).
                    if (!toolCallsEmitted) {
                        yield { type: 'tool_calls', calls: event.tool_calls };
                        toolCallsEmitted = true;
                    }
                }
                break;
            case 'done':
                if (!sawContent && !sawToolCalls) throw new Error('AI stream ended without any content');
                // Final flush: check content buffer one last time if we haven't
                // already emitted tool calls.
                if (!toolCallsEmitted) {
                    const extracted = tryExtract();
                    if (extracted) {
                        yield { type: 'tool_calls', calls: extracted };
                        toolCallsEmitted = true;
                    }
                }
                sawContent = true;
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
    /** Streaming native tool call fragment (arguments arrive in pieces). */
    tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
    }>;
}

interface OpenAIChunk {
    choices?: Array<{ delta?: OpenAIDelta; message?: OpenAIDelta; finish_reason?: string | null }>;
    usage?: unknown;
    error?: { message?: string; type?: string };
}

/**
 * Accumulates OpenAI streaming `delta.tool_calls` fragments.
 *
 * Providers emit tool calls incrementally: the `id`/`name` arrive on the first
 * fragment of a call and `arguments` are streamed as string deltas keyed by
 * `index`. Fragments are merged by index — never concatenated blindly, which
 * would corrupt parallel tool calls.
 */
export function createToolCallAccumulator(): {
    push: (deltas: NonNullable<OpenAIDelta['tool_calls']>) => void;
    finish: () => AIToolCall[];
} {
    const byIndex = new Map<number, { id: string; name: string; args: string }>();
    const order: number[] = [];
    return {
        push(deltas) {
            for (const d of deltas) {
                if (!d || typeof d !== 'object') continue;
                const idx = typeof d.index === 'number' ? d.index : order.length;
                let entry = byIndex.get(idx);
                if (!entry) {
                    entry = { id: '', name: '', args: '' };
                    byIndex.set(idx, entry);
                    order.push(idx);
                }
                if (typeof d.id === 'string' && d.id) entry.id = d.id;
                if (d.function?.name) entry.name += d.function.name;
                if (typeof d.function?.arguments === 'string') entry.args += d.function.arguments;
            }
        },
        finish() {
            const calls: AIToolCall[] = [];
            for (const idx of order) {
                const e = byIndex.get(idx)!;
                if (!e.name) continue;
                calls.push({
                    id: e.id || `call_${idx}`,
                    type: 'function',
                    function: { name: e.name, arguments: e.args },
                });
            }
            return calls;
        },
    };
}

/**
 * Maps a raw OpenAI-compatible SSE stream (used by the direct-provider fallback
 * path) to normalized `AIStreamEvent`s. `reasoning_content` is surfaced as a
 * separate `reasoning` event and never mixed into `delta`.
 *
 * Additionally, this function detects JSON-style tool-call payloads embedded
 * in assistant `content` deltas and converts them to structured
 * `type: 'tool_calls'` events, so they are not rendered as ordinary assistant
 * prose. Only complete, standalone JSON tool-call envelopes are recognized
 * (see `extractToolCallsFromContent`); prose, code fences, and JSON examples
 * are left untouched.
 */
export async function* streamFromOpenAI(
    response: Response,
    signal?: AbortSignal,
): AsyncGenerator<AIStreamEvent, void, unknown> {
    const toolCalls = createToolCallAccumulator();
    /** Accumulates content deltas so we can detect a complete JSON tool-call
     *  payload that arrived across one or more chunks.  Never executed
     *  independently — only used to decide whether to emit a
     *  `type: 'tool_calls'` event instead of `type: 'delta'` content. */
    let contentBuffer = '';
    /** Tracks whether we have already emitted a tool_calls event (via native
     *  deltas or JSON extraction) so we never emit duplicates. */
    let toolCallsEmitted = false;
    /** Tracks that we have seen at least one meaningful signal from the provider. */
    let sawAnySignal = false;

    /** Guarded extraction — see `mayBeToolPayload` (O(n²) parse avoidance). */
    const tryExtract = (): AIToolCall[] | null =>
        (!toolCallsEmitted && mayBeToolPayload(contentBuffer)) ? extractToolCallsFromContent(contentBuffer) : null;

    for await (const block of parseSseBlocks(response, signal)) {
        if (block.done) {
            // Finish accumulating native tool calls and emit if not already done.
            if (!toolCallsEmitted) {
                const calls = toolCalls.finish();
                if (calls.length) {
                    yield { type: 'tool_calls', calls };
                    toolCallsEmitted = true;
                } else {
                    // Also check the content buffer for a standalone JSON tool call
                    // that may have arrived in the last chunk(s).
                    const extracted = tryExtract();
                    if (extracted && !toolCallsEmitted) {
                        yield { type: 'tool_calls', calls: extracted };
                        toolCallsEmitted = true;
                    }
                }
            }
            sawAnySignal = true;
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
                sawAnySignal = true;
                if (!toolCallsEmitted) {
                    const calls = toolCalls.finish();
                    if (calls.length) yield { type: 'tool_calls', calls };
                }
                yield { type: 'done', usage: chunk.usage as AIUsage };
                return;
            }
            continue;
        }
        const delta = choice.delta ?? choice.message;

        // Reasoning delta — never mixed into delta or tool_calls.
        if (delta?.reasoning_content) {
            sawAnySignal = true;
            yield { type: 'reasoning', content: delta.reasoning_content };
        }

        // Native tool-call deltas — accumulate by index.
        if (delta?.tool_calls?.length) {
            sawAnySignal = true;
            toolCalls.push(delta.tool_calls);
        }

        // Content delta — also check for a JSON-style tool-call payload.
        if (delta?.content) {
            sawAnySignal = true;
            contentBuffer += delta.content;

            // Try to extract a complete tool-call from the accumulated content.
            // extractToolCallsFromContent is strict: it only matches when the
            // (fence-stripped) content starts with `{` or `[` and contains a
            // recognized tool-call envelope.  This prevents false positives from
            // code examples, prose, or JSON embedded in explanatory text.
            if (!toolCallsEmitted) {
                const extracted = tryExtract();
                if (extracted && extracted.length > 0) {
                    // Found a complete tool-call payload — emit it structured,
                    // then reset the buffer so further content is not misinterpreted.
                    yield { type: 'tool_calls', calls: extracted };
                    toolCallsEmitted = true;
                    contentBuffer = '';
                } else {
                    // Not a tool-call payload — yield as regular content delta.
                    yield { type: 'delta', content: delta.content };
                }
            } else {
                // We already emitted tool calls; just accumulate remaining text
                // (but do not try another extraction to avoid duplicates).
                // Optionally we could still yield delta content for transparency,
                // but we skip it to keep the UI clean.
            }
        }

        // If the model sends a finish reason, flush whatever we have.
        if (choice.finish_reason) {
            if (!toolCallsEmitted) {
                const calls = toolCalls.finish();
                if (calls.length) yield { type: 'tool_calls', calls };
                // Also check content buffer one last time.
                const extracted = contentBuffer.trim()
                    ? extractToolCallsFromContent(contentBuffer)
                    : null;
                if (extracted) {
                    yield { type: 'tool_calls', calls: extracted };
                    toolCallsEmitted = true;
                }
            }
            sawAnySignal = true;
            yield { type: 'done', usage: chunk.usage as AIUsage, finishReason: choice.finish_reason };
            return;
        }
    }

    // If the loop ended without a done (e.g. abort), flush pending state.
    if (!sawAnySignal) {
        throw new Error('AI stream ended without any content');
    }
    if (!toolCallsEmitted) {
        const calls = toolCalls.finish();
        if (calls.length) yield { type: 'tool_calls', calls };
        // Also check content buffer one final time.
        const extracted = contentBuffer.trim()
            ? extractToolCallsFromContent(contentBuffer)
            : null;
        if (extracted) {
            yield { type: 'tool_calls', calls: extracted };
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