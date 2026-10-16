import type * as Monaco from 'monaco-editor';
import { copyRules, insertRules, withWordKeywords, type MonarchModule } from './shared';

/**
 * Python tokenizer shim — Dark+ fidelity patch over Monaco's stock `python.js`.
 *
 * Stock behavior: keywords AND builtins (`self`, `print`, `len`, `None`,
 * `True`) all emit bare `keyword`; every other name is `identifier`.
 *
 * Changes (root state only, prepended before the stock identifier rule):
 *  1. `self` / `cls` → `variable.predefined` (Dark+ `variable.language`,
 *     blue — MagicPython scopes both as `variable.language.special.*`).
 *  2. Dunder calls `__init__(` → `function` (Dark+ `entity.name.function`,
 *     pale yellow). Bare dunders keep `keyword`.
 *  3. Call lookahead for lowercase words `word(?=\s*\()` → `function`:
 *     `greet(`. Builtins are classified by rule 5, keywords stay keywords
 *     through the `@keywords` guard.
 *  4. Uppercase-first words → `type.identifier` (Dark+ teal): class names
 *     such as `Greeter`. `None`/`True`/`False` keep `keyword` (Dark+
 *     `constant.language`, blue) via the `@keywords` guard placed first.
 *  5. Builtin functions (`print`, `len`, `range`, …) → `support.function`
 *     (Dark+ pale yellow). Computed as keywords-minus-Python-kwlist so the
 *     stock keyword list (which mixes hard keywords, soft keywords, builtins
 *     and dunders) needs no hand-maintenance; `self`/`cls`/dunders keep
 *     their dedicated rules above.
 *  6. Word-level Dark+ operator mapping: `and`/`or`/`not`/`is`/`in` →
 *     `keyword.operator.logical` (Dark+ blue, like `keyword`); `as` →
 *     `keyword.control.as` (Dark+ `keyword.control.import`, purple).
 *  7. All remaining stock `@keywords` emission is normalized from bare
 *     `keyword` to `keyword.$0` so control keywords (`if`, `for`, `return`,
 *     …) resolve to the theme's purple control rules.
 */
const PY_HARD_KEYWORDS = new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'case', 'class', 'continue', 'def', 'del', 'elif', 'else',
    'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass', 'raise',
    'return', 'try', 'type', 'while', 'with', 'yield',
]);

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function patchPythonLanguage(base: MonarchModule): Monaco.languages.IMonarchLanguage {
    const lang = base.language;
    const tokenizer = { ...lang.tokenizer };

    const stockKeywords = Array.isArray((lang as { keywords?: unknown }).keywords)
        ? ((lang as { keywords?: string[] }).keywords ?? [])
        : [];
    // Builtin TYPE names (`str`, `int`, …) are teal in annotation position
    // (Dark+ support.type) but yellow when called (`int(x)`), so they are
    // excluded from the always-yellow builtin guard and get a dedicated
    // call-lookahead rule instead.
    const TYPE_WORDS = new Set([
        'str', 'int', 'float', 'bool', 'complex', 'bytes', 'bytearray',
        'list', 'dict', 'tuple', 'set', 'frozenset', 'object',
    ]);
    const builtinWords = stockKeywords.filter(
        (k) => typeof k === 'string' && !PY_HARD_KEYWORDS.has(k) && !TYPE_WORDS.has(k) && k !== 'self' && k !== 'cls' && !/^__\w+__$/.test(k),
    );
    const builtinGuard =
        builtinWords.length > 0 ? `~^(${builtinWords.map(escapeRegExp).join('|')})$` : null;

    const selfRule: Monaco.languages.IMonarchLanguageRule = [/\b(self|cls)\b/, 'variable.predefined'];
    const dunderCallRule: Monaco.languages.IMonarchLanguageRule = [/__\w+__(?=\s*\()/, 'function'];
    const typeCallRule: Monaco.languages.IMonarchLanguageRule = [
        /\b(str|int|float|bool|complex|bytes|bytearray|list|dict|tuple|set|frozenset|object)(?=\s*\()/,
        'function',
    ];
    // Lowercase-only: uppercase words (class names, `None`) are handled by
    // the upper rule below so constructors stay teal.
    const callRule: Monaco.languages.IMonarchLanguageRule = [
        /[a-z_]\w*(?=\s*\()/,
        {
            cases: {
                // Builtins called as functions stay yellow even though they
                // are members of the stock keyword list.
                ...(builtinGuard ? { [builtinGuard]: 'function' } : {}),
                '@keywords': { token: 'keyword.$0' },
                '@default': 'function',
            },
        },
    ];
    const upperRule: Monaco.languages.IMonarchLanguageRule = [
        /[A-Z]\w*/,
        {
            cases: {
                '@keywords': { token: 'keyword.$0' },
                '@default': 'type.identifier',
            },
        },
    ];

    const root = copyRules(tokenizer['root']);
    const identIndex = root.findIndex(
        (r) => Array.isArray(r) && r[0] instanceof RegExp && r[0].source === '[a-zA-Z_]\\w*',
    );

    // Enrich the stock identifier rule's cases with the Dark+ word mapping,
    // then prepend the new classification rules ahead of it. Builtins come
    // before @keywords (they are members of the stock keyword list).
    const enriched = root.map((rule, i) => {
        if (i !== identIndex) return rule;
        if (!Array.isArray(rule) || rule.length < 2) return rule;
        const action = rule[1];
        if (!action || typeof action !== 'object' || Array.isArray(action)) return rule;
        const cases = (action as { cases?: Record<string, unknown> }).cases;
        if (!cases || cases['@keywords'] !== 'keyword') return rule;
        const rest = rule.length > 2 ? [rule[2]] : [];
        return [
            rule[0],
            {
                ...action,
                cases: {
                    ...(builtinGuard ? { [builtinGuard]: { token: 'support.function' } } : {}),
                    '~^(and|or|not|is|in)$': { token: 'keyword.operator.logical' },
                    as: { token: 'keyword.control.as' },
                    '@keywords': { token: 'keyword.$0' },
                    '@default': 'identifier',
                },
            },
            ...rest,
        ] as Monaco.languages.IMonarchLanguageRule;
    });

    const patchedRoot =
        identIndex >= 0
            ? insertRules(enriched, identIndex, selfRule, dunderCallRule, typeCallRule, callRule, upperRule)
            : [...withWordKeywords([selfRule, dunderCallRule, typeCallRule, callRule, upperRule]), ...enriched];

    return {
        ...lang,
        tokenizer: { ...tokenizer, root: patchedRoot },
    };
}
