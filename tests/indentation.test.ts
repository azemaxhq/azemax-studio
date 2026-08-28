/**
 * Regression tests for the global AI code-generation indentation fix.
 *
 * Covers:
 *   - The reported Python try/except dedent bug (and nested variants).
 *   - repairPythonIndentation across block kinds (if/elif/else, for/else,
 *     while/else, try/except/else/finally, def, class, with, async, match/case,
 *     decorators, multiline strings, comments).
 *   - normalizeGeneratedCode: CRLF/CR->LF, safe fence removal (backticks inside
 *     strings untouched), reasoning removal, string/comment/blank preservation.
 *   - validateGeneratedCode: reasoning leak, markdown leak, empty blocks,
 *     indentation jumps, language mismatch.
 *   - sanitizeEditorOutputWithPolicy integration (the canonical gate).
 *   - applyStructuredEdits / shiftReplacementIndent: multiline replacements
 *     keep relative indentation and never alter indent inside multiline strings.
 *   - The streaming contract: normalize operates on the COMPLETE response even
 *     when the raw input was assembled from awkward chunk splits.
 *
 * Run with: npx tsx tests/indentation.test.ts
 */
import { check, finish } from './_harness';
import {
    repairPythonIndentation,
    normalizeGeneratedCode,
    stripMarkdownFences,
    normalizeLineEndings,
} from '../src/core/ai/AICodeNormalizer';
import {
    validateGeneratedCode,
    hasReasoningLeak,
} from '../src/core/ai/AICodeValidator';
import { sanitizeEditorOutputWithPolicy } from '../src/core/ai/AIOutputPolicy';
import {
    applyStructuredEdits,
    shiftReplacementIndent,
} from '../src/core/ai/AIResponseParser';
import { detectIndentUnit, createPythonScanner } from '../src/core/ai/languageIndentation';

const normalize = (code: string, lang: string): string =>
    normalizeGeneratedCode(code, { language: lang });

// ============================================================================
// 1. The reported bug
// ============================================================================

{
    // Exactly the reported case: a `print` body line dedented to the `try`
    // header level, with `except` still following at that indent.
    const broken = [
        'if __name__ == "__main__":',
        '    try:',
        '        num = int(input("Enter a non-negative integer: "))',
        '    print(f"Factorial for the given number is {factorial(num)}")',
        '    except ValueError as e:',
        '        print(f"Error: {e}")',
    ].join('\n');

    const fixed = repairPythonIndentation(broken);
    const lines = fixed.split('\n');
    check('bug: print is re-indented into try body', lines[3] === '        print(f"Factorial for the given number is {factorial(num)}")');
    check('bug: except stays at header indent', lines[4] === '    except ValueError as e:');
    check('bug: try body indentation preserved', lines[2] === '        num = int(input("Enter a non-negative integer: "))');
    check('bug: validation passes after repair', validateGeneratedCode(fixed, { language: 'python' }).valid === true);
}

// ============================================================================
// 2. Python block kinds
// ============================================================================

{
    const ifElif = [
        'def classify(x):',
        '    if x > 0:',
        '        return "pos"',
        '    return "neg"',
    ].join('\n');
    check('py: unchanged code untouched', repairPythonIndentation(ifElif) === ifElif);

    // Nested: dedented inner body inside if, elif follows the if.
    const nested = [
        'if a:',
        '    if b:',
        '        x()',
        '    y()',
        'elif c:',
        '    z()',
    ].join('\n');
    const nestedFixed = repairPythonIndentation(nested);
    check('py: nested valid code preserved', nestedFixed === nested);

    // for / else with a legitimately placed `else` (directly after the body).
    const forElseValid = [
        'for i in range(3):',
        '    print(i)',
        'else:',
        '    print("no break")',
    ].join('\n');
    check('py: valid for/else preserved', repairPythonIndentation(forElseValid) === forElseValid);

    // A statement dedented between the loop body and `else:` is the same bug
    // pattern and is re-indented into the loop body.
    const forElseBroken = [
        'for i in range(3):',
        '    print(i)',
        'print("done")',
        'else:',
        '    print("no break")',
    ].join('\n');
    const forElseFixed = repairPythonIndentation(forElseBroken);
    check('py: for/else dedent repaired', forElseFixed === [
        'for i in range(3):',
        '    print(i)',
        '    print("done")',
        'else:',
        '    print("no break")',
    ].join('\n'));

    // try/except/else/finally chain must remain stable.
    const tryChain = [
        'try:',
        '    f()',
        'except ValueError:',
        '    g()',
        'else:',
        '    h()',
        'finally:',
        '    i()',
    ].join('\n');
    check('py: try/except/else/finally preserved', repairPythonIndentation(tryChain) === tryChain);
}

// ============================================================================
// 3. Block repair must NOT fire on legitimately ended blocks
// ============================================================================

{
    // `bar()` ends the `if` block implicitly; no closer follows -> unchanged.
    const ended = [
        'def f():',
        '    if x:',
        '        a()',
        '    b()',
        'return 0',
    ].join('\n');
    // `return` at col 0 closes def implicitly too.
    const fixed = repairPythonIndentation(ended);
    check('py: implicit block end untouched', fixed === ended);
}

// ============================================================================
// 4. First-body-statement dedent (empty-block syntax error) is repaired
// ============================================================================

{
    const emptyBody = ['def foo():', 'pass'].join('\n');
    const fixed = repairPythonIndentation(emptyBody);
    check('py: first body line re-indented', fixed === 'def foo():\n    pass');
}

// ============================================================================
// 5. Strings / comments / blank lines are preserved verbatim
// ============================================================================

{
    const withStrings = [
        'def f():',
        '    s = """',
        '    try:',
        '        print("hello")',
        '    """',
        '    return s',
    ].join('\n');
    check('py: triple-quoted string preserved', repairPythonIndentation(withStrings) === withStrings);

    const withComments = [
        'def f():',
        '    # comment about try',
        '    try:',
        '        x()',
        '    except ValueError:',
        '        # inner comment',
        '        y()',
    ].join('\n');
    check('py: comments preserved', repairPythonIndentation(withComments) === withComments);

    const withBlank = ['try:', '    a()', '', 'except:', '    b()'].join('\n');
    check('py: blank line preserved', repairPythonIndentation(withBlank) === withBlank);
}

// ============================================================================
// 6. CRLF / CR normalization
// ============================================================================

{
    check('nl: CRLF -> LF', normalizeLineEndings('a\r\nb\r\nc') === 'a\nb\nc');
    check('nl: lone CR -> LF', normalizeLineEndings('a\rb\rc') === 'a\nb\nc');
    check('nl: mixed preserved LF', normalizeLineEndings('a\nb\r\nc\rd') === 'a\nb\nc\nd');
}

// ============================================================================
// 7. Markdown fences: safe removal, backticks inside strings untouched
// ============================================================================

{
    check('fence: leading fence removed', stripMarkdownFences('```python\nx = 1\n```') === 'x = 1');
    check('fence: language tag stripped', stripMarkdownFences('```\ndef f():\n    pass\n```') === 'def f():\n    pass');
    check('fence: interior indentation preserved', stripMarkdownFences('```\nif a:\n    b()\n```') === 'if a:\n    b()');
    check('fence: no fence -> unchanged', stripMarkdownFences('const s = `x`;') === 'const s = `x`;');
}

// ============================================================================
// 8. Reasoning removal (full response, not per-chunk)
// ============================================================================

{
    const withReasoning = '<thinking>The user wants a sum function</thinking>\n\ndef sum(a, b):\n    return a + b\n';
    check('reasoning: thinking block removed', normalize(withReasoning, 'python').startsWith('def sum(a, b):'));
    check('reasoning: leak not detected after normalize', hasReasoningLeak(normalize(withReasoning, 'python')) === false);
    check('reasoning: raw leak detected before normalize', hasReasoningLeak(withReasoning) === true);
}

// ============================================================================
// 9. Streaming contract: chunk splits must not corrupt the final normalize
// ============================================================================

{
    // Simulate a stream that splits mid-indentation and mid-reasoning.
    const chunks = [
        '<thin',
        'king>',
        'The user wants a factorial function',
        '</thin',
        'king>',
        '```p',
        'ython\n',
        'def foo():',
        '\n    try:',
        '\n        a()',
        '\n    pri',
        'nt("hi")',
        '\n    except:',
        '\n        b()',
        '\n```',
    ];
    const assembled = chunks.join('');
    const fixed = normalize(assembled, 'python');
    const expected = 'def foo():\n    try:\n        a()\n        print("hi")\n    except:\n        b()';
    check('stream: chunk-split response normalized once', fixed === expected);
    check('stream: validation passes', validateGeneratedCode(fixed, { language: 'python' }).valid === true);
}

// ============================================================================
// 10. Validation rejections
// ============================================================================

{
    check('validate: markdown leak rejected', validateGeneratedCode('```\nconst x = 1;\n```', { language: 'typescript' }).valid === false);
    check('validate: reasoning leak rejected', validateGeneratedCode('<thinking>x</thinking>\nconst y = 1;', { language: 'typescript' }).valid === false);
    check('validate: empty block rejected (python)', validateGeneratedCode('try:\nexcept ValueError:', { language: 'python' }).valid === false);
    check('validate: valid python passes', validateGeneratedCode('def f():\n    pass\n', { language: 'python' }).valid === true);
    check('validate: valid ts passes', validateGeneratedCode('const x = 1;\nfunction f() { return x; }\n', { language: 'typescript' }).valid === true);
}

// ============================================================================
// 11. sanitizeEditorOutputWithPolicy integration (canonical gate)
// ============================================================================

{
    const gated = sanitizeEditorOutputWithPolicy(
        '<thinking>The user wants a factorial</thinking>\n```python\n' +
        'def factorial(n):\n    try:\n        return n\n    print("bad indent")\n    except ValueError:\n        return 0\n```',
        { task: 'generate', language: 'python' },
    );
    const gatedLines = gated.split('\n');
    check('policy: reasoning stripped', !gated.includes('thinking'));
    check('policy: fences stripped', !gated.includes('```'));
    check('policy: python indent repaired', gatedLines[3] === '        print("bad indent")');
    check('policy: except aligned', gatedLines[4] === '    except ValueError:');
}

{
    const tsGated = sanitizeEditorOutputWithPolicy(
        '```typescript\nconst arr = [1, 2, 3];\n// The user wants a sum\nconst sum = arr.reduce((a, b) => a + b);\n```',
        { task: 'edit', language: 'typescript' },
    );
    check('policy: ts meta-commentary stripped', !tsGated.includes('The user wants'));
    check('policy: ts code preserved', tsGated.includes('reduce'));
}

// ============================================================================
// 12. Structured edits: relative indent, string-aware shifting
// ============================================================================

{
    const shifted = shiftReplacementIndent('x = 1\n    y = 2\nz = 3', 4);
    check('shift: uniform +4', shifted === '    x = 1\n        y = 2\n    z = 3');

    const neg = shiftReplacementIndent('    a()\n        b()\n    c()', -4);
    check('shift: uniform -4', neg === 'a()\n    b()\nc()');

    const stringSafe = shiftReplacementIndent('s = """\n    inside\n    string\n"""\na()', 2);
    const ssLines = stringSafe.split('\n');
    check('shift: multiline string interior untouched', ssLines[1] === '    inside' && ssLines[2] === '    string');
    check('shift: string delimiters aligned', ssLines[0] === '  s = """' && ssLines[3] === '  """');
    check('shift: trailing code shifted', ssLines[4] === '  a()');
}

{
    // applyStructuredEdits aligns a multiline replacement to the target line.
    const code = ['def f():', '    x = 1', '    return x'].join('\n');
    const replacement = 'y = 2\n    z = 3';
    const result = applyStructuredEdits(code, [
        { startLine: 2, endLine: 2, replacement },
    ]);
    check('structured: replacement aligned to target indent', result === 'def f():\n    y = 2\n        z = 3\n    return x');
}

// ============================================================================
// 13. Scanner / unit detection sanity
// ============================================================================

{
    const sc = createPythonScanner();
    const header = sc.scanLine('    try:');
    check('scan: try is a block header', header.isBlockHeader === true && header.keyword === 'try');
    check('scan: indent counted', header.indent === 4);

    const closer = sc.scanLine('    except ValueError as e:');
    check('scan: except is a closer', closer.closerKeyword === 'except');

    const notHeader = sc.scanLine('x = 1');
    check('scan: assignment not a header', notHeader.isBlockHeader === false);

    const inString = sc.scanLine('s = "def f(): pass"');
    check('scan: colon inside string ignored', inString.isBlockHeader === false);

    const unit = detectIndentUnit(['if a:', '    b()', '        c()'].map((l) => sc.scanLine(l)));
    check('scan: unit detected as 4', unit === 4);
}

// ============================================================================
// 14. Exact reported regression (the live-editor screenshot)
// ============================================================================

{
    const broken = [
        'def is_palindrome(s):',
        "    s = ''.join(c.lower() for c in s if c.isalnum())",
        '    return s == s[::-1]',
        '',
        'if __name__ == "__main__":',
        '    text = input("Enter a string: ")',
        '    if is_palindrome(text):',
        'print("It is a palindrome.")',
        '    else:',
        '        print("It is not a palindrome.")',
    ].join('\n');

    const fixed = repairPythonIndentation(broken);
    const expected = [
        'def is_palindrome(s):',
        "    s = ''.join(c.lower() for c in s if c.isalnum())",
        '    return s == s[::-1]',
        '',
        'if __name__ == "__main__":',
        '    text = input("Enter a string: ")',
        '    if is_palindrome(text):',
        '        print("It is a palindrome.")',
        '    else:',
        '        print("It is not a palindrome.")',
    ].join('\n');
    check('regress: palindrome print re-indented into if body', fixed === expected);
    check('regress: palindrome output validates', validateGeneratedCode(fixed, { language: 'python' }).valid === true);

    const gated = sanitizeEditorOutputWithPolicy(
        broken,
        { task: 'generate', language: 'python' },
    );
    check('regress: palindrome fixed through the canonical gate', gated === expected);
}

// ============================================================================
// 15. First-body statement cases
// ============================================================================

{
    check(
        'first-body: def/return re-indented',
        repairPythonIndentation('def foo():\nreturn 0') === 'def foo():\n    return 0',
    );

    const classDefPrint = ['class Foo:', 'def hello(self):', 'print("hi")'].join('\n');
    check('first-body: class/def/print nested', repairPythonIndentation(classDefPrint) === [
        'class Foo:',
        '    def hello(self):',
        '        print("hi")',
    ].join('\n'));

    check(
        'first-body: try/pass re-indented',
        repairPythonIndentation('def foo():\n    try:\npass') === 'def foo():\n    try:\n        pass',
    );
}

// ============================================================================
// 16. Closer dedented below its block
// ============================================================================

{
    // Body properly indented, but `else:` is at column 0 with no outer block
    // at column 0 that can own it -> re-aligned with the inner `if`.
    const innerElse = [
        'def process():',
        '    if a:',
        '        do_a()',
        '        do_a2()',
        'else:',
        '    do_b()',
    ].join('\n');
    check('closer: else at 0 aligns with inner if', repairPythonIndentation(innerElse) === [
        'def process():',
        '    if a:',
        '        do_a()',
        '        do_a2()',
        '    else:',
        '        do_b()',
    ].join('\n'));

    // Both the inner body AND the closer dedented to column 0. The outer
    // block at column 0 cannot accept `else`, so the body re-enters the inner
    // block and the closer stays at the outer level.
    const bothDedented = [
        'if __name__ == "__main__":',
        '    text = input("x")',
        '    if is_ok(text):',
        'print("ok")',
        'else:',
        '    print("no")',
    ].join('\n');
    const bothFixed = repairPythonIndentation(bothDedented);
    check('closer: body at 0 re-indented, else kept at outer level', bothFixed === [
        'if __name__ == "__main__":',
        '    text = input("x")',
        '    if is_ok(text):',
        '        print("ok")',
        'else:',
        '    print("no")',
    ].join('\n'));
    check('closer: both-dedented output validates', validateGeneratedCode(bothFixed, { language: 'python' }).valid === true);

    // A closer that belongs to an OUTER block at its own indent must not be
    // dragged down to the inner block.
    const outerElse = [
        'if outer:',
        '    if inner:',
        '        x()',
        'else:',
        '    y()',
    ].join('\n');
    check('closer: else kept for outer block at its own level', repairPythonIndentation(outerElse) === outerElse);

    // elif dedented below a non-repaired if aligns with it too.
    check('closer: elif dedented aligns with if', repairPythonIndentation(
        ['def foo():', '    if a:', '        x()', 'elif b:', '    y()'].join('\n'),
    ) === [
        'def foo():',
        '    if a:',
        '        x()',
        '    elif b:',
        '        y()',
    ].join('\n'));
}

// ============================================================================
// 17. Validator: sibling blocks and dedented-closer rejection
// ============================================================================

{
    const siblingBlocks = [
        'if a:',
        '    x()',
        'if b:',
        '    y()',
        'else:',
        '    z()',
    ].join('\n');
    check('validator: sibling blocks not falsely rejected', validateGeneratedCode(siblingBlocks, { language: 'python' }).valid === true);
    check('validator: sibling blocks preserved by normalizer', repairPythonIndentation(siblingBlocks) === siblingBlocks);

    // If normalization were bypassed, a dedented closer must be rejected.
    const dedentedCloser = [
        'def process():',
        '    if a:',
        '        do_a()',
        'else:',
        '    do_b()',
    ].join('\n');
    check('validator: dedented closer rejected (normalize bypass)', validateGeneratedCode(dedentedCloser, { language: 'python' }).valid === false);
}

finish();