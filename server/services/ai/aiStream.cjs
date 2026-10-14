const STREAM_IDLE_TIMEOUT_MS = 45000;

/**
 * Writes a single SSE `data:` frame. Safe to call repeatedly; no-ops once the
 * response is ended or destroyed.
 */
function writeSse(res, payload) {
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
}

// ============================================================================
// Leading reasoning-preamble suppressor (defensive secondary layer)
// ============================================================================
//
// Some backends (notably hosted Nemotron variants) can put reasoning text into
// the `content` channel WITHOUT `reasoning_content` and WITHOUT thinking
// markers, e.g.:
//
//   "Self-Correction/Refinement during thought:
//    The prompt says...
//    Wait, the prompt says...
//    All constraints checked...
//    Hello! How can I help you?"
//
// The provider-native `reasoning_content` field is the authoritative separation
// (dropped in `pipeProviderStream`). This suppressor is the defensive second
// layer: while the visible stream is still at its START (no real content has
// been emitted), whole lines that look like internal-reasoning narration are
// discarded. As soon as the first non-reasoning line completes, everything
// after it flows untouched — TTFB for real content is preserved because a line
// that is not a reasoning-preamble prefix is flushed immediately.

const LEADING_REASONING_LINE_RE = [
    /^self-correction\/[a-z0-9-]+\s*(?:during\s+\w+|[:：]|$)/i,
    /^the prompt says[:：]?/i,
    /^wait,? the prompt says/i,
    /^all constraints? (?:checked|satisfied|verified)[:：]?/i,
    /^final check[:：]?/i,
    /^let me (?:think|check|review|analyze|verify|consider)[:：]?/i,
    /^let'?s (?:check|review|analyze|look at|verify|see)[:：]?/i,
    /^i (?:need to|will|am going to|should|have to)[:：]?/i,
    /^(?:my|the) (?:approach|plan|strategy|reasoning|thought)\s*[:：]/i,
    /^(?:note|notes)\s*[:：]/i,
    /^result\s*[:：]/i,
    /^reasoning (?:trace|process)[:：]?/i,
    /^internal (?:reasoning|verification|check)[:：]?/i,
    /^chain of thought[:：]?/i,
    /^system prompt[:：]?/i,
    /^developer instructions?[:：]?/i,
    /^the user (?:wants|asked|needs|requested|would like|is asking|is trying|is requesting)[:：]?/i,
];

const LEADING_REASONING_PREFIXES = [
    'self-correction',
    'the prompt says',
    'wait, the prompt says',
    'all constraints',
    'final check',
    'let me ',
    "let's ",
    'lets ',
    'i need to',
    'i will',
    'i am going to',
    'i should',
    'i have to',
    'my approach',
    'my plan',
    'my strategy',
    'my reasoning',
    'my thought',
    'the approach',
    'the plan',
    'the strategy',
    'the reasoning',
    'the thought',
    'note:',
    'notes:',
    'result:',
    'reasoning trace',
    'reasoning process',
    'internal reasoning',
    'internal verification',
    'internal check',
    'chain of thought',
    'system prompt',
    'developer instructions',
    'the user wants',
    'the user asked',
    'the user needs',
    'the user requested',
    'the user would like',
    'the user is asking',
    'the user is trying',
    'the user is requesting',
];

const MAX_LEAD_HOLD = 1024;

function isReasoningPreambleLine(line) {
    const t = line.trim();
    return t !== '' && LEADING_REASONING_LINE_RE.some((re) => re.test(t));
}

function isPossiblePreamblePrefix(text) {
    const t = text.trimStart().toLowerCase();
    if (t === '') return false;
    return LEADING_REASONING_PREFIXES.some((p) => p.startsWith(t) && t.length < p.length);
}

function createLeadingPreambleSuppressor() {
    let done = false;
    let justDropped = false; // last discarded line was a reasoning preamble
    let buf = '';
    let out = '';

    return {
        /** Feed visible text; returns the text safe to emit ('' while holding). */
        feed(chunk) {
            if (done) return chunk;
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                const t = line.trim();
                if (t === '') {
                    // Blank line: skip it when it directly follows a dropped
                    // reasoning preamble (keeps the start clean); otherwise pass
                    // it through untouched so legitimate leading whitespace
                    // (e.g. after a thinking-block closer) is preserved.
                    if (!justDropped) out += '\n';
                    continue;
                }
                if (isReasoningPreambleLine(line)) {
                    justDropped = true; // internal narration: drop
                    continue;
                }
                // First real content: emit from this line onward and stop holding.
                done = true;
                out += line + '\n' + buf;
                buf = '';
                return out;
            }
            // No complete line yet — partial first line.
            if (buf.length > MAX_LEAD_HOLD) {
                done = true;
                out += buf;
                buf = '';
                return out;
            }
            if (isReasoningPreambleLine(buf)) {
                // A partial line that ALREADY reads as a complete reasoning
                // preamble (e.g. "Self-Correction/Refinement during thought:")
                // is dropped even without a trailing newline.
                buf = '';
                justDropped = true;
                return out;
            }
            if (isPossiblePreamblePrefix(buf)) return out; // keep holding
            done = true;
            out += buf;
            buf = '';
            return out;
        },
        /** Flush remaining held text at stream end. Reasoning-only tail is dropped. */
        end() {
            if (done) return buf;
            // A lone partial line that is a known preamble PREFIX (e.g. "The p",
            // "Self-Correc") is ambiguous internal narration — drop it rather
            // than risk a reasoning fragment at the very start.
            if (buf !== '' && (isReasoningPreambleLine(buf) || isPossiblePreamblePrefix(buf))) {
                return '';
            }
            if (buf.trim() !== '') {
                done = true;
                const rest = buf;
                buf = '';
                return rest;
            }
            return '';
        },
    };
}

// ============================================================================
// createVisibleContentFilter — the ONE canonical reasoning/content filter.
// ============================================================================

function createVisibleContentFilter() {
    const OPEN = ['\n thinking', '\n analysis', '<think', '<analysis'];
    const CLOSE_XML = ['\n response', '</think', '</analysis'];
    const CLOSE_QWEN = ['\n response', '</think', '</analysis'];
    const TAIL = 32;
    const MAX_THINK_HOLD = 4096;

    let normalBuf = '';
    let held = '';
    let inThinking = false;
    let xmlStyle = false;
    const leadingSuppressor = createLeadingPreambleSuppressor();

    const findAny = (text, markers) => {
        let bestIndex = -1;
        let bestMarker = null;
        for (const m of markers) {
            const i = text.indexOf(m);
            if (i !== -1 && (bestIndex === -1 || i < bestIndex)) {
                bestIndex = i;
                bestMarker = m;
            }
        }
        return bestIndex === -1 ? null : { index: bestIndex, marker: bestMarker };
    };

    const partialTailLen = (text, markers) => {
        let maxLen = 0;
        for (const m of markers) {
            for (let l = 1; l < m.length; l++) {
                if (text.endsWith(m.slice(0, l))) maxLen = Math.max(maxLen, l);
            }
        }
        return maxLen;
    };

    const process = () => {
        let out = '';
        for (;;) {
            if (inThinking) {
                if (held.length > MAX_THINK_HOLD) {
                    held = held.slice(held.length - TAIL);
                }
                const hit = findAny(held, xmlStyle ? CLOSE_XML : CLOSE_QWEN);
                if (!hit) break;
                let rest = held.slice(hit.index + hit.marker.length);
                if (hit.marker === '</think') {
                    // `</think` matched a `</thinking>` closer — consume the
                    // trailing "ing" so no fragment leaks.
                    while (rest.startsWith('ing')) rest = rest.slice(3);
                    if (rest.startsWith('>')) rest = rest.slice(1);
                }
                inThinking = false;
                normalBuf = rest;
                held = '';
                continue;
            }

            const hit = findAny(normalBuf, OPEN);
            if (!hit) {
                const keep = partialTailLen(normalBuf, OPEN);
                const safeLen = Math.max(0, normalBuf.length - keep);
                out += normalBuf.slice(0, safeLen);
                normalBuf = normalBuf.slice(safeLen);
                break;
            }
            out += normalBuf.slice(0, hit.index);
            normalBuf = normalBuf.slice(hit.index + hit.marker.length);
            xmlStyle = hit.marker === '<think';
            inThinking = true;
            held = normalBuf;
            normalBuf = '';
        }
        return out;
    };

    return {
        push(chunk) {
            if (inThinking) held += chunk;
            else normalBuf += chunk;
            return leadingSuppressor.feed(process());
        },
        end() {
            // Unclosed thinking is reasoning: drop it. Normal content is released.
            const out = inThinking ? '' : normalBuf;
            held = '';
            normalBuf = '';
            inThinking = false;
            xmlStyle = false;
            return leadingSuppressor.feed(out) + leadingSuppressor.end();
        },
    };
}

/**
 * Consumes an upstream provider SSE stream, forwards each VISIBLE content delta
 * to the client immediately (never buffered wholesale), and returns
 * `{ tokenCount, usage, reasoningChars }`.
 *
 * Reasoning separation (transport-level, authoritative):
 *   - `delta.reasoning_content` / `message.reasoning_content` are read into a
 *     PRIVATE channel and NEVER forwarded to the client. `onReasoning` (dev
 *     observability) is the only consumer.
 *   - `delta.content` passes through `createVisibleContentFilter`, which
 *     suppresses thinking blocks and leading reasoning preambles even when
 *     split across arbitrary chunk boundaries. Reasoning-only streams yield
 *     zero visible tokens.
 *
 * `onFirstByte` fires on the first network chunk (TTFB), distinct from the
 * first visible token (`onFirstToken`).
 */
/**
 * Accumulates OpenAI-compatible streaming `delta.tool_calls` fragments.
 *
 * Providers emit tool calls incrementally: `id`/`name` arrive on the first
 * fragment of a call and `arguments` stream as string deltas keyed by `index`.
 * Fragments are merged by index — blind concatenation would corrupt parallel
 * tool calls. Malformed entries (no function name) are dropped at `finish`.
 */
function createToolCallAccumulator() {
    const byIndex = new Map();
    const order = [];
    return {
        push(deltas) {
            if (!Array.isArray(deltas)) return;
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
                if (d.function && typeof d.function.name === 'string') entry.name += d.function.name;
                if (d.function && typeof d.function.arguments === 'string') entry.args += d.function.arguments;
            }
        },
        finish() {
            const calls = [];
            for (const idx of order) {
                const e = byIndex.get(idx);
                if (!e || !e.name) continue;
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

/** Also normalize a complete (non-streamed) `message.tool_calls` array. */
function normalizeOneToolCall(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const obj = item;
    let name = '';
    let rawArgs = '';
    let id = '';
    const fn = obj.function;
    if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string' && fn.name) {
        name = fn.name;
        rawArgs = fn.arguments ?? fn.args ?? fn.parameters ?? '';
        id = typeof obj.id === 'string' ? obj.id : '';
    } else if (typeof obj.name === 'string' && obj.name) {
        name = obj.name;
        rawArgs = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? '';
        id = typeof obj.id === 'string' ? obj.id : '';
    }
    if (!name) return null;
    let argumentsString;
    if (typeof rawArgs === 'string') argumentsString = rawArgs;
    else if (rawArgs === undefined || rawArgs === null || rawArgs === '') argumentsString = '{}';
    else {
        try { argumentsString = JSON.stringify(rawArgs); } catch { argumentsString = ''; }
    }
    if (!id) id = `call_${name}_${index}`;
    return { id, type: 'function', function: { name, arguments: argumentsString } };
}

function normalizeToolCalls(raw) {
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
        const one = normalizeOneToolCall(raw, 0);
        return one ? [one] : [];
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
        const call = normalizeOneToolCall(item, out.length);
        if (call) out.push(call);
    }
    return out;
}

function extractToolCallsFromContent(content) {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    let body = trimmed;
    const fence = body.match(/^```(?:json)?\\s*([\\s\\S]*?)\\s*```$/i);
    if (fence) body = fence[1].trim();
    if (!body.startsWith('{') && !body.startsWith('[')) return null;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return null; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) return null;
    const calls = normalizeToolCalls(arr);
    if (calls.length !== arr.length) return null;
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i];
        const hasArgs = Object.prototype.hasOwnProperty.call(obj, 'arguments') ||
            Object.prototype.hasOwnProperty.call(obj, 'args') ||
            Object.prototype.hasOwnProperty.call(obj, 'parameters') ||
            Object.prototype.hasOwnProperty.call(obj, 'input');
        if (!hasArgs && arr.length === 1) return null;
    }
    return calls;
}

async function pipeProviderStream(response, res, onChunk, onFirstToken, onFirstByte, onReasoning) {
    if (!response.body) {
        throw new Error('Provider returned no response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const filter = createVisibleContentFilter();
    const toolCalls = createToolCallAccumulator();
    let buffer = '';
    let tokenCount = 0;
    let usage = null;
    let reasoningChars = 0;
    let firstTokenSent = false;
    let firstByteSent = false;
    /** A tool-call-only turn emits no visible token but is NOT empty. */
    let sawToolCalls = false;

    const finish = () => {
        const tail = filter.end();
        if (tail) {
            writeSse(res, { type: 'token', content: tail });
            tokenCount += 1;
        }
        const calls = toolCalls.finish();
        if (calls.length) {
            writeSse(res, { type: 'tool_calls', tool_calls: calls });
        }
        // `sawToolCalls` lets the caller treat a tool-only turn as success.
        return { tokenCount, usage, reasoningChars, toolCallCount: calls.length || (sawToolCalls ? 1 : 0) };
    };

    while (true) {
        let readResult;
        try {
            readResult = await reader.read();
        } catch (readErr) {
            console.error('[pipeProviderStream] reader.read failed:', readErr.message);
            throw readErr;
        }
        const { done, value } = readResult;
        if (done) break;
        if (!firstByteSent) {
            firstByteSent = true;
            if (typeof onFirstByte === 'function') onFirstByte();
        }
        if (typeof onChunk === 'function') onChunk();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
                return finish();
            }

            try {
                const parsed = JSON.parse(payload);
                if (parsed.usage && parsed.usage.total_tokens !== undefined) {
                    usage = parsed.usage;
                }
                const choice = parsed.choices?.[0];
                const delta = choice?.delta ?? choice?.message;
                if (!delta) continue;

                // PRIVATE channel: reasoning is never forwarded to the client.
                const reasoningDelta = delta.reasoning_content;
                if (reasoningDelta) {
                    reasoningChars += reasoningDelta.length;
                    if (typeof onReasoning === 'function') onReasoning(reasoningDelta);
                }

                // TOOL channel: accumulated, emitted once complete at finish().
                if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
                    toolCalls.push(delta.tool_calls);
                    sawToolCalls = true;
                }

                // VISIBLE channel: only content deltas, through the canonical
                // filter (thinking blocks + leading reasoning preambles).
                const contentDelta = delta.content;
                if (contentDelta) {
                    const visible = filter.push(contentDelta);
                    if (visible) {
                        writeSse(res, { type: 'token', content: visible });
                        tokenCount += 1;
                        if (!firstTokenSent) {
                            firstTokenSent = true;
                            if (typeof onFirstToken === 'function') onFirstToken();
                        }
                    }
                }
            } catch {
                /* ignore partial SSE chunks */
            }
        }
    }

    return finish();
}

module.exports = {
    STREAM_IDLE_TIMEOUT_MS,
    writeSse,
    createVisibleContentFilter,
    createLeadingPreambleSuppressor,
    createToolCallAccumulator,
    normalizeToolCalls,
    extractToolCallsFromContent,
    pipeProviderStream,
};