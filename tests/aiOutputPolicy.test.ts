/**
 * Regression tests for the editor output policy (AIOutputPolicy): the gate that
 * decides whether generated comments reach Monaco, strips model meta-commentary,
 * validates comment syntax per language, and preserves existing comments.
 *
 * Run with: npx tsx tests/aiOutputPolicy.test.ts
 */
import { check, finish } from './_harness';
import {
    sanitizeEditorOutputWithPolicy,
    stripAiMetaCommentary,
    stripInvalidCommentSyntax,
    validateCommentSyntax,
    resolveLanguageFromFilename,
    resolveOutputMode,
    isCommentingIntent,
    isDocumentingIntent,
} from '../src/core/ai/AIOutputPolicy';
import { normalizeLanguage } from '../src/core/ai/commentSyntax';
import { hasReasoningLeak, validateGeneratedCode } from '../src/core/ai/AICodeValidator';

{
    // Autocomplete / edit modes must never contain new meta-commentary.
    const cleaned = sanitizeEditorOutputWithPolicy(
        '```ts\nconst x = 1;\n```\n\n// Here is the code you wanted\n',
        { task: 'autocomplete', language: 'typescript' },
    );
    check('policy: fences stripped', !cleaned.includes('```'));
    check('policy: meta-commentary stripped in autocomplete', !cleaned.includes('Here is the code'));

    const edit = sanitizeEditorOutputWithPolicy(
        'const y = 2;\n// The user wants this function to return the sum\nfunction sum(a, b) { return a + b; }\n',
        { task: 'edit', language: 'javascript' },
    );
    check('policy: process-voice comment stripped in edit', !edit.includes('The user wants'));
    check('policy: real code preserved', edit.includes('function sum(a, b)'));

    // preserve: an existing comment in the file must survive any mode.
    const withPreserve = sanitizeEditorOutputWithPolicy(
        '// This function returns the sum\nfunction sum(a, b) { return a + b; }\n',
        { task: 'autocomplete', language: 'typescript', preserve: '// This function returns the sum' },
    );
    check('policy: existing comment preserved', withPreserve.includes('// This function returns the sum'));

    // Comment mode: content comments survive, process-voice still stripped.
    const commentMode = sanitizeEditorOutputWithPolicy(
        '// The user wants a sum function\n// This function returns the sum\nfunction sum(a, b) { return a + b; }\n',
        { outputMode: 'comment', language: 'typescript' },
    );
    check('policy: comment mode strips process voice', !commentMode.includes('The user wants'));
    check('policy: comment mode keeps content comment', commentMode.includes('// This function returns the sum'));

    // Python: a `//` comment is invalid syntax and must be removed in comment mode.
    const py = sanitizeEditorOutputWithPolicy(
        '// wrong marker\n# correct marker\ndef f():\n    pass\n',
        { outputMode: 'comment', language: 'python' },
    );
    check('policy: invalid python comment syntax stripped', !py.includes('// wrong marker'));
    check('policy: valid python comment kept', py.includes('# correct marker'));
}

{
    // Fenced output extraction happens inside the policy sanitizer.
    const fenced = sanitizeEditorOutputWithPolicy('```python\nprint("hi")\n```', { task: 'generate', language: 'python' });
    check('policy: fenced block unwrapped', fenced === 'print("hi")');

    // Reasoning/thinking blocks never reach the editor.
    const think = sanitizeEditorOutputWithPolicy('<thinking>The user wants X</thinking>\nconst a = 1;\n', { task: 'edit', language: 'typescript' });
    check('policy: thinking block stripped', !think.includes('thinking'));
    check('policy: code after thinking kept', think.includes('const a = 1'));
}

{
    check('policy: resolveLanguageFromFilename tsx', resolveLanguageFromFilename('Foo.tsx') === 'typescript');
    check('policy: resolveLanguageFromFilename py', resolveLanguageFromFilename('script.py') === 'python');
    check('policy: normalizeLanguage C#', normalizeLanguage('C#') === 'csharp');
    check('policy: normalizeLanguage js', normalizeLanguage('.js') === 'javascript');

    check('policy: isCommentingIntent add comments', isCommentingIntent('add comments to this function') === true);
    check('policy: isCommentingIntent negative', isCommentingIntent('fix the bug') === false);
    check('policy: isDocumentingIntent docstrings', isDocumentingIntent('add docstrings') === true);

    check('policy: resolveOutputMode explicit wins', resolveOutputMode({ outputMode: 'fix' }) === 'fix');
    check('policy: resolveOutputMode comment intent', resolveOutputMode({ userInstruction: 'add comments' }) === 'comment');
    check('policy: resolveOutputMode default edit', resolveOutputMode({}) === 'edit');
}

{
    check('strip: process-voice line removed', !stripAiMetaCommentary('// The user wants X\ncode').includes('The user wants'));
    check('strip: preserved line kept', stripAiMetaCommentary('// keep me\ncode', '// keep me').includes('// keep me'));

    const syntax = stripInvalidCommentSyntax('# fine\n// invalid\nx = 1', 'python');
    check('strip: invalid comment line removed', !syntax.includes('// invalid') && syntax.includes('# fine') && syntax.includes('x = 1'));

    check('validate: valid python passes', validateCommentSyntax('# ok\nx = 1', 'python') === true);
    check('validate: invalid python fails', validateCommentSyntax('// nope', 'python') === false);
}

{
    // Validator gate: the new critical leak patterns are rejected even if a
    // reasoning line slips past transport-level filters.
    const leaks = [
        'Self-Correction/Refinement during thought: the sum is 42',
        'Self-Correction/Verification during thought: rechecking',
        'The prompt says to return the sum',
        'Wait, the prompt says to return the sum',
        'All constraints satisfied: done',
        'All constraints checked',
        'Reasoning trace: first I...',
        'Internal reasoning: the answer is 4',
        'Chain of thought: step one',
    ];
    for (const line of leaks) {
        check(`validator: rejects "${line}"`, hasReasoningLeak(line) === true);
    }
    check('validator: plain code not flagged', hasReasoningLeak('const x = 1; // self-correction in a comment') === false);
    check('validator: validateGeneratedCode rejects reasoning line', validateGeneratedCode('Self-Correction/Refinement during thought: X\nconst a = 1;', { language: 'typescript' }).valid === false);
    check('validator: validateGeneratedCode accepts clean code', validateGeneratedCode('function sum(a, b) { return a + b; }', { language: 'typescript' }).valid === true);
}

finish('aiOutputPolicy');
