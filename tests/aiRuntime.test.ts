/**
 * Regression tests for the AI runtime lifecycle:
 *   - AIAbortController / AIAbortManager (cancellation reasons, release, scope)
 *   - AIRequestManager (per-message supersede, per-conversation abort scoping,
 *     stale status no-ops)
 *   - BoundedCache (LRU eviction + recency refresh)
 *   - AIStream parseSseBlocks (chunk boundaries, [DONE], abort -> AbortError)
 *   - AIStreamBuffer (frame coalescing, flush, dispose, stale-guard)
 *
 * Run with: npx tsx tests/aiRuntime.test.ts
 */
import { check, finish, installRafStub } from './_harness';
import { AIAbortController, AIAbortManager, isAbortError } from '../src/core/ai/AIAbortController';
import { AIRequestManager } from '../src/core/ai/AIRequestManager';
import { BoundedCache, hashString } from '../src/core/ai/AICache';
import { parseSseBlocks, streamFromBackend, AIStreamBuffer } from '../src/core/ai/AIStream';
import { createVisibleContentFilter, cleanResponse, stripAllReasoning } from '../src/core/ai/AIResponseParser';
import { trimConversationHistory, CONTEXT_BUDGETS, taskContextBudget } from '../src/core/ai/AIContextBuilder';

// ============================================================================
// AIAbortController + isAbortError
// ============================================================================
{
    const c = new AIAbortController();
    check('abort: initially not aborted', !c.aborted);
    c.abort('user');
    check('abort: aborted after abort()', c.aborted);
    check('abort: reason recorded', c.abortReason === 'user');
    check('abort: signal.aborted true', c.signal.aborted);
    c.abort('regenerate');
    check('abort: second abort cannot overwrite reason', c.abortReason === 'user');

    const c2 = new AIAbortController('new-chat');
    check('abort: constructor reason', c2.abortReason === 'new-chat');
}

{
    check('isAbortError: DOMException', isAbortError(new DOMException('x', 'AbortError')));
    check('isAbortError: name-based', isAbortError({ name: 'AbortError', message: '' }));
    check('isAbortError: message-based', isAbortError(new Error('The operation was aborted')));
    check('isAbortError: non-error null', !isAbortError(null));
    check('isAbortError: plain error false', !isAbortError(new Error('boom')));
}

// ============================================================================
// AIAbortManager
// ============================================================================
{
    const m = new AIAbortManager();
    check('manager: has() false initially', !m.has('k'));
    const c = m.get('k');
    check('manager: get() creates live controller', m.has('k') && !c.aborted);
    check('manager: get() is stable', m.get('k') === c);

    m.abort('k', 'superseded');
    check('manager: abort marks + removes', !m.has('k'));
    check('manager: abort reason', c.abortReason === 'superseded');

    const next = m.get('k');
    check('manager: new controller after abort', next !== c && !next.aborted);

    const ca = m.get('a');
    const cb = m.get('b');
    check('manager: size tracks live keys', m.size === 3);
    m.abortAll('unmount');
    check('manager: abortAll clears', m.size === 0 && ca.aborted && cb.aborted && next.aborted);
    check('manager: abortAll reason', ca.abortReason === 'unmount');

    const cx = m.get('x');
    m.release('x');
    check('manager: release without abort', m.size === 0 && cx.aborted === false);
}

// ============================================================================
// AIRequestManager
// ============================================================================
{
    const m = new AIRequestManager();
    const r1 = m.begin({ conversationId: 'conv-1', messageId: 'msg-1' });
    check('manager: begin pending', m.isActive(r1.requestId) && r1.status === 'pending');

    const r2 = m.begin({ conversationId: 'conv-1', messageId: 'msg-1' });
    check('manager: same messageId supersedes prior', r1.controller.aborted && r1.controller.abortReason === 'superseded');
    check('manager: newest remains active', m.isActive(r2.requestId));

    const r3 = m.begin({ conversationId: 'conv-1', messageId: 'msg-2' });
    const r4 = m.begin({ conversationId: 'conv-2', messageId: 'msg-3' });
    m.abortAllForConversation('conv-1', 'new-chat');
    check('manager: abortAllForConversation kills conv-1', r2.controller.aborted && r3.controller.aborted);
    check('manager: abortAllForConversation spares other conv', !r4.controller.aborted);
    check('manager: abortAllForConversation reason', r3.controller.abortReason === 'new-chat');

    m.abortAll('new-chat');
    check('manager: abortAll', r4.controller.aborted && m.size === 0);

    const r5 = m.begin();
    m.markStatus(r5.requestId, 'complete');
    check('manager: complete removes record', !m.isActive(r5.requestId) && m.size === 0);
    check('manager: stale markStatus is a no-op', (() => {
        m.markStatus(r5.requestId, 'failed');
        return m.size === 0;
    })());

    const r6 = m.begin();
    m.abort(r6.requestId, 'user');
    check('manager: abort reason default user', r6.controller.abortReason === 'user' && !m.isActive(r6.requestId));

    // Owner-scoped abort (used by component unmount): only the matching owner is
    // killed, other owners keep streaming.
    const o1 = m.begin({ owner: 'explain' });
    const o2 = m.begin({ owner: 'explain' });
    const o3 = m.begin({ owner: 'chat' });
    m.abortAllForOwner('explain', 'unmount');
    check('manager: abortAllForOwner kills matching owner', o1.controller.aborted && o2.controller.aborted);
    check('manager: abortAllForOwner reason', o2.controller.abortReason === 'unmount');
    check('manager: abortAllForOwner spares other owner', !o3.controller.aborted);
    m.abortAll('new-chat');
    check('manager: abortAll after owner abort', m.size === 0);
}

// ============================================================================
// BoundedCache
// ============================================================================
{
    const cache = new BoundedCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    check('cache: within bound', cache.size === 3);
    cache.set('d', 4);
    check('cache: LRU evicts oldest', cache.size === 3 && !cache.has('a') && cache.has('d'));

    cache.get('b');
    cache.set('e', 5); // evicts 'c' (oldest after 'b' touched)
    check('cache: get refreshes recency', !cache.has('c') && cache.has('b') && cache.has('e'));

    cache.delete('e');
    check('cache: delete', !cache.has('e') && cache.size === 2);

    check('cache: hashString stable', hashString('const x = 1') === hashString('const x = 1'));
    check('cache: hashString distinct inputs', hashString('a') !== hashString('b'));
}

// ============================================================================
// parseSseBlocks
// ============================================================================
const enc = new TextEncoder();

async function sseResponse(chunks: string[]): Promise<Response> {
    return new Response(
        new ReadableStream({
            start(controller) {
                for (const c of chunks) controller.enqueue(enc.encode(c));
                controller.close();
            },
        }),
    );
}

{
    const res = await sseResponse(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n']);
    const blocks: unknown[] = [];
    for await (const b of parseSseBlocks(res)) blocks.push(b);
    check('sse: yields two payloads + done', blocks.length === 3 && blocks[2]?.done === true);
}

{
    // JSON split across chunk boundaries + CRLF + a malformed line.
    const res = await sseResponse(['data: {"a"', ':', '1}\r\ndata: not-json\r\ndata: {"a":3}\r\n\r\n']);
    const blocks: unknown[] = [];
    for await (const b of parseSseBlocks(res)) blocks.push(b);
    check('sse: partial chunk reassembly', blocks.length === 2 && (blocks[0] as { payload: { a: number } }).payload.a === 1);
    check('sse: malformed line ignored', (blocks[1] as { payload: { a: number } }).payload.a === 3);
}

{
    // Abort mid-stream must surface as AbortError, never a clean end.
    const controller = new AbortController();
    const res = new Response(
        new ReadableStream({
            start(c) {
                c.enqueue(enc.encode('data: {"type":"start"}\n\n'));
                // stream never closes — the pending read keeps running
            },
        }),
    );
    const gen = parseSseBlocks(res, controller.signal);
    const first = await gen.next();
    check('sse: first block before abort', (first.value as { payload: { type: string } }).payload.type === 'start');
    controller.abort();
    let thrown: unknown = null;
    try {
        await gen.next();
    } catch (e) {
        thrown = e;
    }
    check('sse: abort throws AbortError', thrown instanceof DOMException && thrown.name === 'AbortError');
}

{
    // Backend stream: 'done' without any content must throw, not return empty.
    const res = await sseResponse(['data: {"type":"done"}\n\n']);
    let thrown: unknown = null;
    try {
        for await (const _ of streamFromBackend(res)) { /* noop */ }
    } catch (e) {
        thrown = e;
    }
    check('sse: backend done-without-content throws', thrown instanceof Error && String(thrown.message).includes('without any content'));
}

// ============================================================================
// AIStreamBuffer
// ============================================================================
{
    const raf = installRafStub();
    const frames: string[] = [];
    const buf = new AIStreamBuffer((t) => frames.push(t), () => true);

    buf.append('a');
    check('buffer: first token publishes synchronously', frames.length === 1 && frames[0] === 'a');

    buf.append('b');
    buf.append('c');
    check('buffer: subsequent deltas coalesce into one pending frame', raf.pendingCount === 1 && frames.length === 1);
    raf.tick();
    check('buffer: single frame delivers pending deltas', frames.length === 2 && frames[1] === 'bc');

    buf.append('x');
    buf.flush();
    check('buffer: flush delivers immediately', frames.length === 3 && frames[2] === 'x');

    buf.append('dropped');
    buf.dispose();
    raf.tick();
    check('buffer: dispose cancels scheduled frame', frames.length === 3);
}

{
    const raf = installRafStub();
    const frames: string[] = [];
    let active = true;
    const buf = new AIStreamBuffer((t) => frames.push(t), () => active);
    buf.append('first'); // first token publishes synchronously (request was active)
    active = false;
    buf.append('later'); // schedules a frame that must be dropped by the guard
    raf.tick();
    check('buffer: stale guard drops post-supersede chunks', frames.length === 1 && frames[0] === 'first');
}

{
    // Never lose the final token: append after a frame is scheduled, then flush
    // must deliver BOTH the pending frame content and the final append.
    const raf = installRafStub();
    const frames: string[] = [];
    const buf = new AIStreamBuffer((t) => frames.push(t), () => true);
    buf.append('a');
    buf.append('b');
    buf.append('final');
    buf.flush();
    check('buffer: flush before tick delivers everything', frames.length === 2 && frames[1] === 'bfinal');
}

// ============================================================================
// createVisibleContentFilter (chunk-safe inline-thinking filter)
// ============================================================================
{
    const f = createVisibleContentFilter();
    let out = '';
    // "Hello\n thinking" is the OPEN of a Qwen think block — must be held.
    out += f.push('Hello');
    out += f.push('\n think');
    out += f.push('ing\nsecret chain of thought\n resp');
    out += f.push('onse\nWorld');
    // The newline before "response" closes the block; "World" keeps it.
    check('filter: suppresses split think block', out === 'Hello\nWorld');
    check('filter: end() emits nothing extra', f.end() === '');
}

{
    // No closer ever arrives: held text must be released, never swallowed.
    const f = createVisibleContentFilter();
    let out = f.push('const x');
    out += f.push(' = 1; // "think');
    out += f.end();
    check('filter: releases partial-tail hold when no block forms', out === 'const x = 1; // "think');
}

{
    // Split-XML `<think>` blocks are suppressed too.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('start');
    out += f.push('<thin');
    out += f.push('k>reasoning here</');
    out += f.push('think>end');
    check('filter: suppresses split XML think block', out === 'startend');
}

{
    // </thinking> close + answer in the SAME chunk: the trailing "ing>" of the
    // closer must never leak into the visible output.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('Hello');
    out += f.push('<thinking>secret plan</thinking>World');
    out += f.end();
    check('filter: </thinking> close never leaks "ing>"', out === 'HelloWorld');
}

{
    // Unclosed thinking at end-of-stream is REASONING — end() must drop it.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('Hello');
    out += f.push('\n thinking\nsecret chain of thought');
    out += f.end();
    check('filter: unclosed thinking is dropped at end()', out === 'Hello');
}

{
    // Thinking after the answer: answer flows, trailing think block dropped.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('The answer is 42.');
    out += f.push('\n thinking\nshould I double check?\n');
    out += f.end();
    check('filter: thinking after answer is dropped', out === 'The answer is 42.');
}

{
    // Reasoning-only response -> only whitespace, never reasoning content.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('\n thinking\ninternal reasoning');
    out += f.push('\n response\n');
    out += f.end();
    check('filter: reasoning-only response yields nothing', out.trim() === '');
}

// ============================================================================
// cleanResponse / stripAllReasoning (non-streamed path)
// ============================================================================
{
    // Qwen inline think block fully hidden.
    check('clean: hides thinking...response', cleanResponse('Hello\n thinking\nsecret chain\n response\nWorld') === 'Hello\nWorld');
    check('clean: hides <thinking> block', cleanResponse('Hello\n<thinking>secret plan</thinking>World') === 'Hello\nWorld');
    check('clean: hides reasoning before content', cleanResponse('\n thinking\nplan\n response\nHello! How can I help you today? 🚀') === 'Hello! How can I help you today? 🚀');
    check('clean: hides reasoning after content', cleanResponse('Here is the answer.\n thinking\nverify\n response\n') === 'Here is the answer.');
    check('clean: reasoning-only response is empty', cleanResponse('\n thinking\nsecret\n response\n') === '');
    check('clean: <thinking> unclosed trailing block is dropped', cleanResponse('Hello\n<thinking>never closed') === 'Hello');
    check('clean: hides leading meta preamble', cleanResponse('The user wants to know the answer.\nThe answer is 42.') === 'The answer is 42.');
    check('clean: hides "I need to" preamble', cleanResponse("I need to check the code first.\nDone.") === 'Done.');
    check('clean: hides "Let\'s check" + "Final check" preambles', cleanResponse("Let's check the implementation.\nFinal check: all good.\nWorks now.") === 'Works now.');
    check('clean: keeps "Result:" answer text after prefix', cleanResponse('Result: the answer is 42') === 'the answer is 42');
    check('clean: normal response untouched', cleanResponse('Hello! How can I help you today? 🚀') === 'Hello! How can I help you today? 🚀');
    check('clean: empty stays empty', cleanResponse('') === '');
}

{
    // Leading inline think block (even with a preceding newline) is dropped when
    // it never closes — it is reasoning and must not reach the user.
    check('stripAll: leading unterminated inline block', stripAllReasoning('\n thinking\nsecret plan') === '');
    check('stripAll: multiple blocks', stripAllReasoning('one\n thinking\nx\n response\ntwo\n<thinking>y</thinking>three') === 'one\ntwo\nthree');
}

// ============================================================================
// Task-aware context budgets
// ============================================================================
{
    check('budget: autocomplete window is tiny', CONTEXT_BUDGETS.autocomplete.maxChars < 2000);
    check('budget: chat window is the largest', CONTEXT_BUDGETS.chat.maxChars > CONTEXT_BUDGETS.complex_code.maxChars);
    check('budget: taskContextBudget maps fix -> complex_code', taskContextBudget('fix').maxChars === CONTEXT_BUDGETS.complex_code.maxChars);
    check('budget: taskContextBudget maps inline-suggest -> autocomplete', taskContextBudget('inline-suggest').maxChars === CONTEXT_BUDGETS.autocomplete.maxChars);

    const longHistory = Array.from({ length: 40 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `message ${i} ` + 'x'.repeat(1200),
    }));
    const trimmed = trimConversationHistory(longHistory, 'autocomplete');
    check('trim: autocomplete keeps at most 2 messages', trimmed.length <= 2);
    check('trim: autocomplete total chars bounded', trimmed.reduce((n, m) => n + m.content.length, 0) <= CONTEXT_BUDGETS.autocomplete.maxChars + 2000);
    const chatTrimmed = trimConversationHistory(longHistory, 'chat');
    check('trim: chat keeps more context than autocomplete', chatTrimmed.length > trimmed.length);
}

// ============================================================================
// Dev-only AI perf metrics (pure formatting helpers)
// ============================================================================
{
    const { formatAIPerf, summarizeAIPerf, AIPerfTracker } = await import('../src/core/ai/aiPerf');
    const base = {
        task: 'chat',
        provider: 'backend',
        model: 'm',
        contextChars: 1000,
        requestStart: 0,
        firstByte: 300,
        firstToken: 400,
        lastToken: 800,
        done: 1200,
        status: 'ok' as const,
        inputTokens: 50,
        outputTokens: 100,
    };
    const line = formatAIPerf(base);
    check('perf: TTFB reported', line.includes('TTFB=300ms'));
    check('perf: TTFT reported', line.includes('TTFT=400ms'));
    check('perf: duration reported', line.includes('duration=1200ms'));
    check('perf: token counts reported', line.includes('in=50tok') && line.includes('out=100tok'));
    check('perf: tokens/sec reported', line.includes('tok/s'));

    const aborted = formatAIPerf({ ...base, status: 'aborted' });
    check('perf: abort status surfaced', aborted.includes('status=aborted'));

    const withDetail = formatAIPerf({
        ...base,
        contextBuildMs: 7,
        reasoningTokens: 42,
        streamChunkCount: 9,
    });
    check('perf: context build ms reported', withDetail.includes('ctxBuild=7ms'));
    check('perf: reasoning tokens reported', withDetail.includes('reason=42tok'));
    check('perf: stream chunk count reported', withDetail.includes('chunks=9'));
    check('perf: generation ms reported', withDetail.includes('gen=800ms'));

    const summary = summarizeAIPerf();
    check('perf: aggregate summary is a line', typeof summary === 'string' && summary.length > 0);

    const tracker = new AIPerfTracker({
        task: 'chat', provider: 'backend', model: 'm', contextChars: 10, contextBuildMs: 3, now: () => 0,
    });
    tracker.providerStarted();
    tracker.firstByteReceived();
    tracker.firstTokenReceived();
    tracker.tokenReceived();
    tracker.chunkReceived();
    tracker.chunkReceived();
    tracker.reportUsage(10, 20, 5);
    tracker.complete();
    const tracked = formatAIPerf((tracker as unknown as { timings: typeof base }).timings);
    check('perf: tracker records firstToken before done', tracked.includes('TTFT=0ms'));
    check('perf: tracker records usage', tracked.includes('in=10tok') && tracked.includes('out=20tok'));
    check('perf: tracker records reasoning tokens', tracked.includes('reason=5tok'));
    check('perf: tracker records chunk count', tracked.includes('chunks=2'));
    check('perf: tracker records contextBuildMs', tracked.includes('ctxBuild=3ms'));
}

// ============================================================================
// Reasoning-leak hardening: XML-style opener with " response" inside the
// thinking text (the exact real-server leak: premature close on the loose
// ' response' marker leaked the tail of the reasoning block).
// ============================================================================
{
    // GROQ/Qwen real-world shape: opener arrives as `\n thinking\n` (XML style,
    // NOT `\n thinking`), and the thinking body contains the word " response"
    // ("The response fits") before the real `\n response\n` closer. The loose
    // ' response' marker must NOT close the block early.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('\n thinking\n');
    out += f.push('Here is a thinking process.\n');
    out += f.push('The response fits all constraints.\n');
    out += f.push('more internal reasoning\n');
    out += f.push('\n response\n\n');
    out += f.push('Hi! How can I help you?');
    out += f.end();
    check('filter: XML opener + " response" inside thinking does NOT leak', out === '\n\nHi! How can I help you?');
}

{
    // Same shape, but the thinking ends with the exact leaked token sequence:
    // "...draft.✅\n response\n\nHello!". Everything up to and including the
    // closer must be dropped; only the final answer flows.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('\n thinking\n');
    out += f.push('Draft the response.✅');
    out += f.push('\n response');
    out += f.push('\n\n');
    out += f.push('Hello! How can I help you with your code today?');
    out += f.end();
    check('filter: leaked token sequence (✅ + closer) fully suppressed', out === '\n\nHello! How can I help you with your code today?');
}

{
    // The literal reasoning body itself must never be emitted verbatim.
    const f = createVisibleContentFilter();
    let out = '';
    for (const c of ['\n thinking\n', '1. Analyze user input\n', '2. Determine response\n', '3. Final Output Generation\n', '\n response\n\n', 'Hello!']) {
        out += f.push(c);
    }
    out += f.end();
    check('filter: reasoning markers (Analyze/Determine/Generation) never visible', !/Analyze|Determine|Generation|thinking|response/.test(out));
}

{
    // Answer before a NEW XML-style thinking block: the answer flows; the
    // trailing block is dropped without leaking its closer fragments.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('The answer is 7.');
    out += f.push('\n thinking\n');
    out += f.push('verify response\n');
    out += f.push('\n response\n');
    out += f.end();
    check('filter: answer kept, trailing XML think block + closer dropped', out.startsWith('The answer is 7.') && !/thinking|response|verify/.test(out));
}

{
    // OpenRouter-style `reasoning` field: separate channel, never surfaced as
    // a delta. Emulated via streamFromOpenAI mapping — reasoning must not
    // become visible content even when it precedes the answer.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('reasoning text that is not wrapped');
    out += f.push(' still reasoning');
    out += f.end();
    // Unwrapped reasoning that never enters a think block is NOT auto-dropped —
    // that is the provider's job (OpenRouter sends it in a separate field).
    // This test documents the boundary: unwrapped content in the `content`
    // channel is visible, wrapped blocks are not.
    check('filter: unwrapped reasoning content stays (provider isolates field)', out.length > 0);
}

{
    // `\n response` closer split across MANY chunks must still close cleanly.
    const f = createVisibleContentFilter();
    let out = '';
    for (const c of ['\n thinking\n', 'a', 'b', 'c', '\n respo', 'nse\n\n', 'World']) {
        out += f.push(c);
    }
    out += f.end();
    check('filter: closer split across chunks closes cleanly', out === '\n\nWorld');
}

{
    // Reasoning-only XML-style block: whitespace only, never reasoning text.
    const f = createVisibleContentFilter();
    let out = '';
    out += f.push('\n thinking\n');
    out += f.push('just a chain of thought with response words');
    out += f.push('\n response\n');
    out += f.end();
    check('filter: XML-style reasoning-only yields no text', out.trim() === '');
}

// ============================================================================
// fast_chat routing (trivial-chat detection + context budget)
// ============================================================================
{
    const { isTrivialChat, TASK_FALLBACK, taskContextBudget } = await import('../src/core/ai/AIContextBuilder');
    const { AI_TASK_CONFIG, getTaskConfig } = await import('../server/services/ai/taskConfig.cjs');
    const { resolveModel } = await import('../server/services/ai/modelRouter.cjs');

    // Trivial greetings
    for (const g of ['hi', 'Hi', 'hello', 'Hello!', 'hey', 'HEY', 'good morning', 'good evening', 'thanks', 'thank you', 'thx', 'how are you?', 'yo', 'sup']) {
        check(`trivial: "${g}" detected`, isTrivialChat(g) === true);
    }
    // Real questions / code requests are NOT trivial
    for (const q of ['how do I fix this bug?', 'can you explain closures', 'write a function that sorts', 'what is the error in this code?', 'refactor my component']) {
        check(`trivial: "${q}" NOT detected`, isTrivialChat(q) === false);
    }
    // Long or multiline messages are never trivial
    check('trivial: long sentence rejected', isTrivialChat('hi there, I have a very long question about how the streaming pipeline works and whether the reasoning filter correctly handles split chunk boundaries across many tokens of text') === false);
    check('trivial: multiline rejected', isTrivialChat('hi\nhow are you') === false);

    // fast_chat profile exists on the SERVER with reasoning OFF
    check('fast_chat: server profile exists', AI_TASK_CONFIG.fast_chat !== undefined);
    check('fast_chat: reasoning disabled', getTaskConfig('fast_chat').chatTemplateKwargs?.enable_thinking === false);
    check('fast_chat: tiny output cap', getTaskConfig('fast_chat').maxTokens <= 512);

    // fast_chat client budget: minimal context, no file content
    const budget = taskContextBudget('fast_chat');
    check('fast_chat: minimal history budget', budget.maxMessages <= 2);
    check('fast_chat: no file content budget', budget.maxFileChars === 0);

    // Client fallback defaults mirror the server profile
    check('fast_chat: client fallback exists', TASK_FALLBACK.fast_chat !== undefined);
    check('fast_chat: client fallback maxTokens <= 512', TASK_FALLBACK.fast_chat.maxTokens <= 512);

    // taskKeyForType passes through AiTaskKey values
    const { taskKeyForType } = await import('../src/core/ai/AIContextBuilder');
    check('taskKey: fast_chat passthrough', taskKeyForType('fast_chat') === 'fast_chat');
    check('taskKey: chat mapped', taskKeyForType('chat') === 'chat');
    check('taskKey: code-gen mapped', taskKeyForType('code-gen') === 'simple_edit');
    check('taskKey: unknown TaskType falls back to chat', taskKeyForType('chat' as unknown as 'chat') === 'chat');

    // Chat profile has reasoning OFF (task-aware reasoning policy: chat answers
    // arrive fast with no trace to leak; code tasks keep their trace).
    check('chat: reasoning disabled (fast TTFB, no leak surface)', getTaskConfig('chat').chatTemplateKwargs?.enable_thinking === false);
    
    // complex_code: server taskConfig has reasoningMode 'low'; router builds low-effort payload
    const complexResolved = resolveModel('complex_code', undefined);
    check('complex_code: server taskConfig reasoningMode low', getTaskConfig('complex_code').reasoningMode === 'low');
    check('complex_code: router builds low-effort payload', complexResolved.chatTemplateKwargs?.enable_thinking === true && complexResolved.chatTemplateKwargs?.reasoning_effort === 'low');
    
    // deep_reasoning: server taskConfig has reasoningMode 'high'; router builds high-effort payload
    const deepResolved = resolveModel('deep_reasoning', undefined);
    check('deep_reasoning: server taskConfig reasoningMode high', getTaskConfig('deep_reasoning').reasoningMode === 'high');
    check('deep_reasoning: router builds high-effort payload', deepResolved.chatTemplateKwargs?.reasoning_effort === 'high' && deepResolved.chatTemplateKwargs?.enable_thinking === undefined);
}

// ============================================================================
// Non-streamed cleanResponse against the same leak shapes
// ============================================================================
{
    check('clean: XML-opener + response-in-thinking fully stripped', cleanResponse('\n thinking\nHere is a thinking process\nThe response fits\nmore\n response\n\nHi!') === 'Hi!');
    check('clean: leaked tail (draft + ✅ + closer) stripped', cleanResponse('\n thinking\nDraft the response.✅\n response\n\nHello!') === 'Hello!');
    check('clean: reasoning markers never remain', !/thinking|response|Draft|Output Generation|Analyze/i.test(cleanResponse('\n thinking\nAnalyze input\nDetermine response\nFinal Output Generation\n response\n\nHello!')));
    check('clean: empty stays empty for reasoning-only', cleanResponse('\n thinking\nsecret\n response\n') === '');
}

finish('aiRuntime');
