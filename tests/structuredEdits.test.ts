/**
 * Regression tests for structured edit parsing + safe application
 * (AIResponseParser). Malformed payloads must return null and out-of-range /
 * overlapping edits must never modify the document.
 *
 * Run with: npx tsx tests/structuredEdits.test.ts
 */
import { check, finish } from './_harness';
import { parseStructuredEdits, applyStructuredEdits, cleanResponse } from '../src/core/ai/AIResponseParser';

const code = ['a', 'b', 'c', 'd'].join('\n');

{
    const parsed = parseStructuredEdits(JSON.stringify({ type: 'edit', edits: [{ startLine: 2, endLine: 2, replacement: 'B' }] }));
    check('edits: valid payload parsed', parsed !== null && parsed.edits.length === 1);
    const applied = parsed ? applyStructuredEdits(code, parsed.edits) : null;
    check('edits: applied in place', applied === ['a', 'B', 'c', 'd'].join('\n'));
}

{
    check('edits: fenced payload parsed', parseStructuredEdits('```json\n{"type":"edit","edits":[{"startLine":1,"endLine":1,"replacement":"x"}]}\n```') !== null);
    check('edits: reasoning-wrapped payload parsed', parseStructuredEdits('thinking\n...\nresponse\n{"type":"edit","edits":[{"startLine":1,"endLine":1,"replacement":"x"}]}') !== null);
    check('edits: non-edit JSON -> null', parseStructuredEdits('{"foo":1}') === null);
    check('edits: garbage -> null', parseStructuredEdits('not json at all') === null);
    check('edits: invalid edit shape -> null', parseStructuredEdits('{"type":"edit","edits":[{"nope":1}]}') === null);
}

{
    // Bounds + ordering guards: out-of-range or inverted edits return null.
    check('edits: out-of-range start -> null', applyStructuredEdits(code, [{ startLine: 99, endLine: 99, replacement: 'x' }]) === null);
    check('edits: start > end -> null', applyStructuredEdits(code, [{ startLine: 3, endLine: 2, replacement: 'x' }]) === null);
    check('edits: empty edits -> null', applyStructuredEdits(code, []) === null);
    check('edits: multi-line replacement ok', applyStructuredEdits(code, [{ startLine: 2, endLine: 3, replacement: 'x\ny' }]) === ['a', 'x', 'y', 'd'].join('\n'));
}

{
    check('clean: fences removed', cleanResponse('```ts\nconst x = 1;\n```') === 'const x = 1;');
}

finish('structuredEdits');
