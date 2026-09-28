/**
 * Tests for the /// inline-comment fast path + echo repair
 * (src/core/ai/tripleSlashPipeline.ts).
 *
 * Regression: `int[] arr = {...};///pass different inputs;` left the raw
 * trigger in the file (model echoed `///`, sanitizer passed it through, and
 * the no-op was applied). Literal comment text must now resolve
 * deterministically to `code // text` with canonical syntax.
 *
 * Run with: npx tsx tests/tripleSlashComment.test.ts
 */
import { check, finish } from './_harness';
import {
    buildLiteralInlineComment,
    repairTripleSlashOutput,
} from '../src/core/ai/tripleSlashPipeline';

const JAVA_PREFIX = '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16};';
const TRIGGER = `${JAVA_PREFIX}///pass different inputs;`;

{
    // Fast path: the exact screenshot scenario, no AI involved.
    check(
        'literal: java inline text -> code + // comment',
        buildLiteralInlineComment(JAVA_PREFIX, 'pass different inputs', 'java') ===
            '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16}; // pass different inputs',
    );
    check(
        'literal: python uses # marker',
        buildLiteralInlineComment('  x = 1', 'pass different inputs', 'python') === '  x = 1 # pass different inputs',
    );
    check(
        'literal: trigger terminator ; never leaks into comment',
        buildLiteralInlineComment(JAVA_PREFIX, 'pass different inputs;', 'java') ===
            '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16}; // pass different inputs',
    );
}

{
    // Fast path must NOT steal real intents (they need the model).
    check('literal: edit verb falls through to AI', buildLiteralInlineComment(JAVA_PREFIX, 'fix the loop', 'java') === null);
    check('literal: refactor falls through to AI', buildLiteralInlineComment(JAVA_PREFIX, 'refactor this', 'java') === null);
    check(
        'literal: commenting intent falls through to AI (content must be generated)',
        buildLiteralInlineComment(JAVA_PREFIX, 'add comments explaining this', 'java') === null,
    );
    check(
        'literal: standalone /// (no code prefix) falls through to AI',
        buildLiteralInlineComment('', 'hello world', 'java') === null,
    );
    check(
        'literal: unsupported language falls through to AI',
        buildLiteralInlineComment('{"a": 1}', 'note this', 'json') === null,
    );
}

{
    // Repair: model glitches must never reach the file.
    const prefix = JAVA_PREFIX;
    // Echoed trigger is rebuilt deterministically.
    check(
        'repair: echoed /// rebuilt to canonical comment',
        repairTripleSlashOutput(TRIGGER, prefix, 'pass different inputs', 'java', TRIGGER) ===
            '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16}; // pass different inputs',
    );
    // No-op echo (output == trigger line) is rejected.
    check(
        'repair: no-op echo rejected',
        repairTripleSlashOutput(TRIGGER, prefix, 'fix the loop', 'java', TRIGGER) === null,
    );
    // Comment-only output reattaches the dropped code instead of deleting it.
    check(
        'repair: comment-only output reattaches code',
        repairTripleSlashOutput('// pass different inputs', prefix, 'pass different inputs', 'java', TRIGGER) ===
            '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16}; // pass different inputs',
    );
    // Healthy output passes through untouched.
    const healthy = '  int[] arr = {2, 4, 6, 8, 10, 12, 14, 16}; // pass different inputs';
    check(
        'repair: healthy output untouched',
        repairTripleSlashOutput(healthy, prefix, 'pass different inputs', 'java', TRIGGER) === healthy,
    );
    check('repair: empty output rejected', repairTripleSlashOutput('  ', prefix, 'x', 'java', TRIGGER) === null);
}

{
    // Routing: imperatives and questions must reach the model — echoing them
    // back as `// ...` looks broken (screenshot: `///print only the number;`
    // became a plain comment instead of transforming the code).
    const notePrefix = '  System.out.println(factorial);';
    check(
        'routing: instruction verb falls through to AI',
        buildLiteralInlineComment(notePrefix, 'print only the number', 'java') === null,
    );
    check(
        'routing: explain intent falls through to AI',
        buildLiteralInlineComment(notePrefix, 'explain this', 'java') === null,
    );
    check(
        'routing: question falls through to AI',
        buildLiteralInlineComment(notePrefix, 'what does this do', 'java') === null,
    );
    check(
        'routing: question mark falls through to AI',
        buildLiteralInlineComment(notePrefix, 'does this handle negatives?', 'java') === null,
    );
    check(
        'routing: make/use instruction falls through to AI',
        buildLiteralInlineComment('  let x = 1;', 'use const instead', 'javascript') === null,
    );
    // Genuine literal annotations still resolve instantly with no AI call.
    check(
        'routing: plain annotation stays literal',
        buildLiteralInlineComment(notePrefix, 'factorial of n', 'java') === `${notePrefix} // factorial of n`,
    );
}

finish('tripleSlashComment');
