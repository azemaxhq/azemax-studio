/**
 * Regression tests for the VS Code Dark+ syntax-highlighting implementation.
 *
 * Covers:
 *  - The theme module registers exactly one theme id with Dark+ token
 *    foregrounds on the Midnight Blue background (no legacy palette values).
 *  - Tokenizer shims never mutate Monaco's stock language definitions.
 *  - Shim rule placement: call lookahead before the stock identifier rule,
 *    keyword emission normalized to `keyword.$0`, import-path state present
 *    for Java.
 *  - Registration wiring calls defineTheme + registerTokensProviderFactory
 *    once per language and is idempotent per Monaco instance.
 *
 * Run with: npm test -- tests/darkPlusHighlighting.test.ts
 */
import { check, finish } from './_harness';
import { defineAzemaxDarkPlusTheme, AZEMAX_DARKPLUS_THEME_ID } from '../src/core/editor/azemaxDarkPlusTheme';
import { patchCSharpLanguage } from '../src/core/editor/darkPlusTokenizers/csharp';
import { patchJavaLanguage } from '../src/core/editor/darkPlusTokenizers/java';
import { patchPythonLanguage } from '../src/core/editor/darkPlusTokenizers/python';
import { patchTypeScriptLanguage } from '../src/core/editor/darkPlusTokenizers/typescript';
import { setupAzemaxDarkPlusHighlighting } from '../src/core/editor/darkPlusHighlighting';

// ---------------------------------------------------------------- theme ---

type CapturedTheme = { base: string; inherit: boolean; rules: { token: string; foreground?: string }[]; colors: Record<string, string> };
let captured: CapturedTheme | null = null;
const fakeMonaco = {
    editor: {
        defineTheme: (_id: string, data: CapturedTheme) => { captured = data; },
    },
} as never;

defineAzemaxDarkPlusTheme(fakeMonaco);
const theme = captured as unknown as CapturedTheme;

check('theme id is the single authoritative signature id', AZEMAX_DARKPLUS_THEME_ID === 'azemax-midnight-signature');
check('theme base/inherit', theme.base === 'vs-dark' && theme.inherit === true);

const ruleColor = (token: string): string | undefined =>
    theme.rules.find((r) => r.token === token)?.foreground?.toUpperCase();

// Reference palette token foregrounds.
check('comment muted gray-blue', ruleColor('comment') === '8490A3');
check('keyword electric blue', ruleColor('keyword') === '5D8FFF');
check('control-flow electric blue', ruleColor('keyword.if') === '5D8FFF' && ruleColor('keyword.return') === '5D8FFF' && ruleColor('keyword.new') === '5D8FFF');
check('string rich green', ruleColor('string') === '8CCF9F');
check('number cool white', ruleColor('number') === 'DCE2EB');
check('identifier cool white', ruleColor('identifier') === 'DCE2EB');
check('variable.parameter cool white', ruleColor('variable.parameter') === 'DCE2EB');
check('function electric blue', ruleColor('function') === '5D8FFF');
check('type electric blue', ruleColor('type.identifier') === '5D8FFF');
check('primitive keyword electric blue', ruleColor('keyword.int') === '5D8FFF' && ruleColor('keyword.string') === '5D8FFF' && ruleColor('keyword.void') === '5D8FFF');
check('delimiter bracket yellow', ruleColor('delimiter.parenthesis') === 'FFD600' && ruleColor('delimiter.curly') === 'FFD600');
check('operator muted gray-blue', ruleColor('operator') === '8490A3');
check('default text cool white', ruleColor('') === 'DCE2EB');
check('constant.language electric blue', ruleColor('constant.language') === '5D8FFF');

// Legacy custom palette must be gone.
const legacy = ['70D8E8', 'C5A6FF', '82A8FF', '8FDEB3', 'A9BEFF', 'A6B9D7', '91A3BE', 'A7B9D2', 'DCE6F5'];
const used = new Set(theme.rules.map((r) => (r.foreground ?? '').toUpperCase()));
check('no legacy palette colors in token rules', legacy.every((c) => !used.has(c)));

// Reference background preserved; UI colors intact.
check('reference background preserved', theme.colors['editor.background'] === '#10141B');
check('editor foreground is cool white', theme.colors['editor.foreground'] === '#DCE2EB');
check('cursor and selection colors intact', theme.colors['editorCursor.foreground'] === '#5D8FFF' && theme.colors['editor.selectionBackground'] === '#5D8FFF40');
check('indent guide color', theme.colors['editorIndentGuide.background1'] === '#252D39');
check('current line background', theme.colors['editor.lineHighlightBackground'] === '#171C25');
check('matched bracket background and border', theme.colors['editorBracketMatch.background'] === '#202B43' && theme.colors['editorBracketMatch.border'] === '#405B91');

// ------------------------------------------------------------- shims ---

const fakeBase = (tokenizer: Record<string, unknown[]>, extra: Record<string, unknown> = {}) => ({
    language: { tokenPostfix: '.x', keywords: ['if', 'else'], ...extra, tokenizer } as never,
});

const identRule = (token: string) => [/[a-zA-Z_]\w*/, { cases: { '@keywords': token, '@default': 'identifier' } }] as never;

// C#: rules prepended before stock identifier rule; stock def untouched.
{
    const stockRoot = [identRule('keyword'), [/[;,.]/, 'delimiter']] as never[];
    const stockQualified = [identRule('keyword')] as never[];
    const base = fakeBase({ root: stockRoot, qualified: stockQualified });
    const beforeRoot = JSON.stringify(stockRoot);
    const beforeQualified = JSON.stringify(stockQualified);
    const patched = patchCSharpLanguage(base);
    check('csharp: stock root not mutated', JSON.stringify(stockRoot) === beforeRoot);
    check('csharp: stock qualified not mutated', JSON.stringify(stockQualified) === beforeQualified);
    const root = patched.tokenizer['root'] as unknown[];
    check('csharp: two rules prepended', root.length === stockRoot.length + 2);
    check('csharp: postfix preserved', (patched as { tokenPostfix: string }).tokenPostfix === '.x');
}

// Java: import-path state added; loader-supplied extras preserved.
{
    const base = fakeBase({ root: [identRule('keyword')] });
    const patched = patchJavaLanguage(base);
    check('java: importpath state added', Array.isArray(patched.tokenizer['importpath']));
    check('java: importFollows declared', (patched as { importFollows: string[] }).importFollows.join(',') === 'import,package');
    check('java: rules prepended', (patched.tokenizer['root'] as unknown[]).length === 4);
}

// Python: keyword normalization to keyword.$0 + logical/as mapping.
{
    const base = fakeBase({ root: [identRule('keyword')] }, { keywords: ['if', 'print', 'len', 'self', '__dict__'] });
    const patched = patchPythonLanguage(base);
    const root = patched.tokenizer['root'] as never[];
    const stock = root.find((r) => Array.isArray(r) && (r[0] as RegExp).source === '[a-zA-Z_]\\w*') as unknown as [RegExp, { cases: Record<string, unknown> }];
    check('python: stock ident rule found', !!stock);
    check('python: keywords emit keyword.$0', (stock[1].cases as Record<string, { token: string }>)['@keywords']?.token === 'keyword.$0');
    check('python: logical words mapped', !!stock[1].cases['~^(and|or|not|is|in)$']);
    check('python: builtins mapped to support.function', Object.keys(stock[1].cases).some((k) => k.startsWith('~^(') && (stock[1].cases[k] as { token: string })?.token === 'support.function'));
    check('python: self excluded from builtins', !Object.keys(stock[1].cases).some((k) => k.startsWith('~^(') && k.includes('self')));
    check('python: dunders excluded from builtins', !Object.keys(stock[1].cases).some((k) => k.startsWith('~^(') && k.includes('__dict__')));
    check('python: self/cls rule first', Array.isArray(root[0]) && ((root[0] as unknown[])[1] === 'variable.predefined'));
}

// TypeScript: call rule prepended to shared common state; keywords -> $0.
{
    const common = [identRule('keyword'), [/[A-Z][\w$]*/, 'type.identifier']] as never[];
    const base = fakeBase({ root: [[/[{}]/, 'delimiter.bracket'], { include: 'common' }], common });
    const before = JSON.stringify(common);
    const patched = patchTypeScriptLanguage(base);
    check('ts: stock common not mutated', JSON.stringify(common) === before);
    const out = patched.tokenizer['common'] as never[];
    check('ts: call rule prepended to common', out.length === common.length + 1);
    const rewritten = out.find(
        (r) =>
            Array.isArray(r) &&
            typeof (r[1] as { cases?: Record<string, unknown> })?.cases?.['@keywords'] === 'object',
    ) as unknown as [RegExp, { cases: Record<string, { token: string }> }] | undefined;
    check('ts: keywords emit keyword.$0', rewritten?.[1].cases['@keywords']?.token === 'keyword.$0');
}

// ------------------------------------------------------ registration ---

{
    const defined: string[] = [];
    const factories: string[] = [];
    const loaders: Record<string, () => Promise<never>> = {
        csharp: async () => ({ language: { tokenPostfix: '.cs', tokenizer: {} } }) as never,
        java: async () => ({ language: { tokenPostfix: '.java', tokenizer: {} } }) as never,
        python: async () => ({ language: { tokenPostfix: '.py', tokenizer: {} } }) as never,
        typescript: async () => ({ language: { tokenPostfix: '.ts', tokenizer: {} } }) as never,
        javascript: async () => ({ language: { tokenPostfix: '.js', tokenizer: {} } }) as never,
    };
    const monaco2 = {
        editor: { defineTheme: (id: string) => { defined.push(id); } },
        languages: {
            getLanguages: () => Object.keys(loaders).map((id) => ({ id, loader: loaders[id] })),
            registerTokensProviderFactory: (id: string) => { factories.push(id); },
        },
    } as never;
    setupAzemaxDarkPlusHighlighting(monaco2);
    setupAzemaxDarkPlusHighlighting(monaco2);
    check('registration: theme defined once (idempotent)', defined.length === 1 && defined[0] === 'azemax-midnight-signature');
    check(
        'registration: factory per language',
        ['csharp', 'java', 'python', 'typescript', 'javascript'].every((l) => factories.includes(l)),
    );
}

finish('darkPlusHighlighting');
