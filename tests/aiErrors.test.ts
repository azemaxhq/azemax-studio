/**
 * Tests for the AIError taxonomy (server + client mirrors): status-driven
 * classification, retryable gating (fallback policy), user-safe serialization,
 * and the reasoning/leak suppression filters that guarantee reasoning never
 * reaches visible content and provider failures are never generated text.
 *
 * Run with: npx tsx tests/aiErrors.test.ts
 */
import { check, finish } from './_harness';

// ============================================================================
// Server AIError (CJS)
// ============================================================================
const server = await import('../server/services/ai/aiError.cjs');
const { classifyProviderError, allProvidersFailed, invalidResponse, aiErrorToUserMessage, AI_ERROR_CODES, AIError } = server;

{
    // Status-driven classification + retryable gating.
    const auth = classifyProviderError({ provider: 'nvidia', model: 'm', status: 401 });
    check('classify: 401 is auth, not retryable', auth.code === AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR && auth.retryable === false);

    const forbidden = classifyProviderError({ provider: 'nvidia', model: 'm', status: 403 });
    check('classify: 403 is auth, not retryable', forbidden.code === AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR && forbidden.retryable === false);

    const badRequest = classifyProviderError({ provider: 'nvidia', model: 'm', status: 400 });
    check('classify: 400 is bad request, not retryable', badRequest.code === AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST && badRequest.retryable === false);

    // Regression: a stale/retired model id returns 404 — it must fall back to
    // the next provider instead of killing the whole chain with
    // "AI is temporarily unavailable".
    const notFound = classifyProviderError({ provider: 'openrouter', model: 'stale/model:free', status: 404 });
    check('classify: 404 is bad request but retryable (stale model falls back)', notFound.code === AI_ERROR_CODES.AI_PROVIDER_BAD_REQUEST && notFound.retryable === true);

    const rateLimited = classifyProviderError({ provider: 'nvidia', model: 'm', status: 429 });
    check('classify: 429 is rate-limited, retryable', rateLimited.code === AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED && rateLimited.retryable === true);

    const serverErr = classifyProviderError({ provider: 'nvidia', model: 'm', status: 500 });
    check('classify: 500 is server error, retryable', serverErr.code === AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR && serverErr.retryable === true);

    const timeout = classifyProviderError({ provider: 'nvidia', model: 'm', message: 'fetch timed out after 45000ms' });
    check('classify: status-less timeout is retryable', timeout.code === AI_ERROR_CODES.AI_PROVIDER_TIMEOUT && timeout.retryable === true);

    const net = classifyProviderError({ provider: 'groq', model: 'm', message: 'fetch failed' });
    check('classify: network failure is retryable', net.code === AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE && net.retryable === true);

    const aborted = classifyProviderError({ provider: 'nvidia', model: 'm', cause: new DOMException('x', 'AbortError') });
    check('classify: abort is not retryable', aborted.code === AI_ERROR_CODES.AI_REQUEST_ABORTED && aborted.retryable === false);
}

{
    // toJSON is user-safe: no developer message, no stack, no details.
    const err = new AIError({
        code: AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED,
        provider: 'nvidia',
        model: 'm',
        status: 429,
        retryable: true,
        message: 'developer-only text: nvidia rate limited (HTTP 429)',
        details: { internal: true },
    });
    const wire = err.toJSON();
    check('toJSON: has code', wire.code === AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED);
    check('toJSON: has userMessage', wire.userMessage.length > 0);
    check('toJSON: never exposes developer message', !JSON.stringify(wire).includes('developer-only'));
    check('toJSON: never exposes details', !('details' in wire));
    check('toJSON: never exposes stack', !('stack' in wire));
    check('toJSON: preserves provider/model/status/retryable', wire.provider === 'nvidia' && wire.model === 'm' && wire.status === 429 && wire.retryable === true);
}

{
    check('userMessage: all-providers-failed', aiErrorToUserMessage(allProvidersFailed([{ provider: 'nvidia', model: 'm' }])).length > 0);
    check('userMessage: auth', aiErrorToUserMessage({ code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR }).includes('authentication'));
    check('userMessage: config', aiErrorToUserMessage({ code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR }).includes('not configured'));
    check('userMessage: rate limited', aiErrorToUserMessage({ code: AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED }).includes('rate limited'));
    check('userMessage: timeout', aiErrorToUserMessage({ code: AI_ERROR_CODES.AI_PROVIDER_TIMEOUT }).includes('timed out'));
    check('userMessage: aborted', aiErrorToUserMessage({ code: AI_ERROR_CODES.AI_REQUEST_ABORTED }).includes('cancelled'));
    check('userMessage: default fallback', aiErrorToUserMessage(null) === 'AI is temporarily unavailable. Please try again.');

    const all = allProvidersFailed([{ provider: 'nvidia', model: 'm' }, { provider: 'groq', model: 'g' }], { requestId: 'r1' });
    check('allProvidersFailed: code + non-retryable', all.code === AI_ERROR_CODES.AI_ALL_PROVIDERS_FAILED && all.retryable === false);

    const empty = invalidResponse({ provider: 'nvidia', model: 'm' });
    check('invalidResponse: code + non-retryable', empty.code === AI_ERROR_CODES.AI_INVALID_RESPONSE && empty.retryable === false);
}

// ============================================================================
// Client AIError mirror
// ============================================================================
const {
    classifyProviderError: clientClassify,
    allProvidersFailed: clientAllFailed,
    aiErrorToUserMessage: clientUserMessage,
    AI_ERROR_CODES: clientCodes,
    AIError: ClientAIError,
} = await import('../src/core/ai/AIError');

{
    check('client classify: 500 retryable', clientClassify({ provider: 'groq', model: 'm', status: 500 }).retryable === true);
    check('client classify: 401 non-retryable', clientClassify({ provider: 'groq', model: 'm', status: 401 }).code === clientCodes.AI_PROVIDER_AUTH_ERROR);
    check('client classify: 429 rate-limited', clientClassify({ provider: 'groq', model: 'm', status: 429 }).code === clientCodes.AI_PROVIDER_RATE_LIMITED);
    const clientAll = clientAllFailed([{ provider: 'groq', model: 'g' }]);
    check('client allProvidersFailed non-retryable', clientAll.code === clientCodes.AI_ALL_PROVIDERS_FAILED && clientAll.retryable === false);
    check('client userMessage safe', clientUserMessage(new ClientAIError({ code: clientCodes.AI_PROVIDER_TIMEOUT })).includes('timed out'));
    const clientWire = new ClientAIError({ code: clientCodes.AI_PROVIDER_AUTH_ERROR, message: 'dev secret', details: { k: 'v' } }).toJSON();
    check('client toJSON hides internals', !JSON.stringify(clientWire).includes('dev secret') && !('details' in clientWire));
}

// ============================================================================
// Reasoning-leak suppression (critical strings MUST NEVER reach visible output)
// ============================================================================
const serverStream = await import('../server/services/ai/aiStream.cjs');
const serverClean = await import('../server/services/ai/aiContext.cjs');
const { createVisibleContentFilter: serverFilter, createLeadingPreambleSuppressor } = serverStream;

const clientParser = await import('../src/core/ai/AIResponseParser');
const { createVisibleContentFilter: clientFilter, stripAllReasoning, cleanResponse } = clientParser;
const { streamFromOpenAI } = await import('../src/core/ai/AIStream');

const CRITICAL_STRINGS = [
    'Self-Correction/Refinement during thought:',
    'Self-Correction/Verification during thought:',
    'The prompt says...',
    'Wait, the prompt says...',
    'All constraints checked...',
    'All constraints satisfied.',
    'I need to check the code first.',
    "Let's check the implementation.",
    'Final check: all good.',
    'My approach: analyze the input',
    'Reasoning trace:',
    'Internal reasoning:',
    'Chain of thought:',
];

function runFilter(filter: ReturnType<typeof clientFilter>, chunks: string[]): string {
    let out = '';
    for (const c of chunks) out += filter.push(c);
    return out + filter.end();
}

for (const filter of [serverFilter, clientFilter]) {
    {
        const out = runFilter(filter(), CRITICAL_STRINGS.map((s) => s + '\n').concat(['Hello! How can I help?']));
        check(`${filter.name || 'filter'}: critical reasoning lines never visible`, out.trim() === 'Hello! How can I help?' && !CRITICAL_STRINGS.some((s) => out.includes(s.slice(0, 20))));
    }
    {
        const out = runFilter(filter(), ['Self-Correction/Refinement during thought:', '\nThe prompt says...', '\n\n', 'Hello!']);
        check(`${filter.name || 'filter'}: single-chunk preamble lines dropped`, out.trim() === 'Hello!');
    }
    {
        const out = runFilter(filter(), CRITICAL_STRINGS.map((s) => s + '\n'));
        check(`${filter.name || 'filter'}: reasoning-only stream is empty`, out.trim() === '');
    }
    {
        const out = runFilter(filter(), ['Four']);
        check(`${filter.name || 'filter'}: plain answer untouched`, out === 'Four');
    }
}

{
    // Preamble split mid-word across chunks is held then dropped, never emitted.
    const sup = createLeadingPreambleSuppressor();
    let out = sup.feed('The p');
    out += sup.feed('rompt says...');
    out += sup.feed('\n\nHello!');
    out += sup.end();
    check('suppressor: split "The prompt says" never leaks', out.trim() === 'Hello!');
}

{
    // cleanResponse / stripAllReasoning (non-streamed) — server + client.
    const dirty = CRITICAL_STRINGS.join('\n') + '\nHello!';
    check('server clean: critical strings stripped', serverClean.cleanResponse(dirty) === 'Hello!');
    check('client stripAllReasoning: critical strings stripped', stripAllReasoning(dirty) === 'Hello!');
    check('client cleanResponse: empty stays empty', cleanResponse(CRITICAL_STRINGS.join('\n')) === '');
    check('client cleanResponse: reasoning-only is empty', cleanResponse('\n thinking\nsecret\n response\n') === '');
}

{
    // streamFromOpenAI: reasoning_content maps to `reasoning` events, NEVER
    // mixed into visible `delta`.
    const enc = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(c) {
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"reasoning_content":"secret chain"}}]}\n\n'));
            c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            c.enqueue(enc.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
            c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
        },
    }));
    const events: string[] = [];
    let reasoningCount = 0;
    let deltaCount = 0;
    for await (const ev of streamFromOpenAI(response)) {
        events.push(ev.type);
        if (ev.type === 'reasoning') reasoningCount++;
        if (ev.type === 'delta') deltaCount++;
    }
    check('streamFromOpenAI: reasoning event separate', reasoningCount === 1);
    check('streamFromOpenAI: delta contains only content', deltaCount === 1);
    check('streamFromOpenAI: done emitted', events.includes('done'));
}

finish('aiErrors');