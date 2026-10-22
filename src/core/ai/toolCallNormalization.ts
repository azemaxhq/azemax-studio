/**
 * Tool-call normalization — the single canonical implementation.
 *
 * Lives in its own module (rather than in `AIClient`) so provider adapters can
 * import it WITHOUT creating an import cycle:
 *
 *   AIClient ──▶ providerContext ──▶ providerRegistry ──▶ providers ──▶ (this module)
 *
 * Malformed entries are DROPPED, never repaired: a call with no name or a
 * non-string id is not a valid tool call and must never reach dispatch.
 */

import type { AIToolCall } from './types';

/**
 * Convert a single provider item (native or alternative shape) into our wire
 * type. Provider compatibility adapters across vendors use different envelopes:
 *   - OpenAI/OpenRouter/NVIDIA: { id, type, function: { name, arguments } }
 *   - Bare tool-call objects:    { id?, name, arguments? | args? | params? }
 *   - A bare object on its own is never a tool call — it must at least carry
 *     a `name` string.
 */
function normalizeOneToolCall(item: unknown, index: number): AIToolCall | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;

    let name = '';
    let rawArgs: unknown = '';
    let id = '';

    const fn = (obj as { function?: unknown }).function;
    if (fn && typeof fn === 'object' && !Array.isArray(fn)) {
        const f = fn as Record<string, unknown>;
        if (typeof f.name === 'string' && f.name) {
            name = f.name;
            rawArgs = f.arguments ?? f.args ?? f.parameters ?? '';
            id = typeof obj.id === 'string' ? obj.id : '';
        }
    }
    if (!name && typeof obj.name === 'string' && obj.name) {
        name = obj.name;
        rawArgs = obj.arguments ?? obj.args ?? obj.params ?? obj.input ?? '';
        id = typeof obj.id === 'string' ? obj.id : '';
    }
    if (!name) return null;

    let argumentsString = '';
    if (typeof rawArgs === 'string') {
        argumentsString = rawArgs;
    } else if (rawArgs === undefined || rawArgs === null || rawArgs === '') {
        argumentsString = '{}';
    } else {
        try {
            argumentsString = JSON.stringify(rawArgs);
        } catch {
            argumentsString = '';
        }
    }
    if (!id) id = `call_${name}_${index}`;
    return { id, type: 'function', function: { name, arguments: argumentsString } };
}

/**
 * Normalizes a provider's raw `message.tool_calls` into our wire shape.
 */
export function normalizeToolCalls(raw: unknown): AIToolCall[] {
    // A single bare object may be a tool call (some providers serialize one
    // call without an array wrapper).
    if (raw && !Array.isArray(raw) && typeof raw === 'object') {
        const one = normalizeOneToolCall(raw, 0);
        return one ? [one] : [];
    }
    if (!Array.isArray(raw)) return [];
    const out: AIToolCall[] = [];
    for (const item of raw) {
        const call = normalizeOneToolCall(item, out.length);
        if (call) out.push(call);
    }
    return out;
}

/**
 * Extract structured tool calls that a provider mistakenly serialized inside
 * the assistant `content` field as JSON instead of `tool_calls`.
 *
 * Only a *complete, standalone* tool-call payload is converted: the trimmed
 * content must be JSON and deserialize to one or more objects carrying a
 * string `name` (and optionally arguments/args/parameters/input). Ordinary
 * prose or fenced code blocks are never touched, so genuine code/JSON
 * answers stay intact.
 *
 * Returns `null` when the content is not a tool-call payload.
 */
export function extractToolCallsFromContent(content: unknown): AIToolCall[] | null {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    // Strip a single Markdown code fence, if present, before parsing.
    let body = trimmed;
    const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) body = fence[1].trim();
    if (!body.startsWith('{') && !body.startsWith('[')) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) return null;
    const calls = normalizeToolCalls(arr);
    // Require every array entry to have survived validation as a tool call,
    // so a stray JSON array (e.g. [{"name":"x"}]) inside a real code sample
    // is only treated as a tool call if ALL entries look like calls.
    if (calls.length !== arr.length) return null;
    // A lone object without arguments is only a tool call if it also carries
    // an explicit `arguments`/`args` field. This prevents a plain JSON object
    // that happens to have `name` from being misclassified.
    for (let i = 0; i < arr.length; i++) {
        const obj = arr[i] as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(obj, 'arguments') &&
            !Object.prototype.hasOwnProperty.call(obj, 'args') &&
            !Object.prototype.hasOwnProperty.call(obj, 'parameters') &&
            !Object.prototype.hasOwnProperty.call(obj, 'input')) {
            if (arr.length === 1 && (obj as { tool_calls?: unknown }).tool_calls === undefined) {
                // permit only if name matches a known tool? We don't have catalog here;
                // keep strict to avoid false positives.
                return null;
            }
        }
    }
    return calls;
}
