import type * as Monaco from 'monaco-editor';
import { copyRules, insertRules, type MonarchModule } from './shared';

/**
 * C# tokenizer shim — Dark+ fidelity patch over Monaco's stock `csharp.js`.
 *
 * Stock behavior (verified by token dump): every identifier is `identifier`,
 * every keyword is `keyword.<word>`; `Console.Write(` is identifier/delimiter.
 * Dark+ behavior: control keywords purple (#C586C0), called methods pale
 * yellow (#DCDCAA), type-like names teal (#4EC9B0).
 *
 * Changes (root + qualified states only):
 *  1. The stock identifier rule is enriched in place (never reordered) with
 *     word-level Dark+ operator/control mapping: `in` → `keyword.control.in`
 *     (purple loop keyword), `await` → `keyword.operator.await`,
 *     `as` → `keyword.operator.as`, `is` → `keyword.operator.is` (Dark+
 *     `keyword.operator`, foreground). The stock `next: '@qualified'`
 *     transitions are preserved exactly.
 *  2. Call lookahead `word(?=\s*\()` → `function` (yellow), inserted BEFORE
 *     the stock identifier rule. Keywords are excluded via the `@keywords`
 *     guard (so `if (`/`for (` stay keywords); `using`/namespace-context
 *     words keep their `keyword.$0` + `@namespace` transition exactly like
 *     stock; `await (` maps to `keyword.operator.await`.
 *  3. Uppercase-first words → `type.identifier` (teal): class names, type
 *     references, `System`/`Console`.
 *  4. In `qualified` (after `.`): calls → `function`; remaining uppercase
 *     words (nested types such as `Console` in `System.Console`) →
 *     `type.identifier`; everything else falls through to the stock rules.
 *
 * Known approximation (documented): `new Foo(` colors `Foo` yellow (function
 * call) because Monarch cannot see that it is a constructor type reference;
 * VS Code's semantic layer colors it teal.
 */
export function patchCSharpLanguage(base: MonarchModule): Monaco.languages.IMonarchLanguage {
    const lang = base.language;
    const tokenizer = { ...lang.tokenizer };

    const root = copyRules(tokenizer['root']);
    const identIndex = root.findIndex(
        (r) => Array.isArray(r) && r[0] instanceof RegExp && r[0].source.includes('@?[a-zA-Z_]'),
    );

    // 1. Enrich the STOCK identifier rule in place. Only the rule whose
    // action chains `next: '@qualified'` (the real stock rule) is touched;
    // rules inserted by this shim never match this predicate.
    const enrichedRoot =
        identIndex >= 0
            ? root.map((rule, i) => {
                  if (i !== identIndex) return rule;
                  if (!Array.isArray(rule) || rule.length < 2) return rule;
                  const action = rule[1];
                  if (!action || typeof action !== 'object' || Array.isArray(action)) return rule;
                  const cases = (action as { cases?: Record<string, unknown> }).cases;
                  if (!cases || !cases['@namespaceFollows'] || !cases['@keywords']) return rule;
                  const rest = rule.length > 2 ? [rule[2]] : [];
                  return [
                      rule[0],
                      {
                          ...action,
                          cases: {
                              '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                              in: { token: 'keyword.control.in' },
                              await: { token: 'keyword.operator.await' },
                              as: { token: 'keyword.operator.as' },
                              is: { token: 'keyword.operator.is' },
                              '@keywords': { token: 'keyword.$0', next: '@qualified' },
                              '@default': { token: 'identifier', next: '@qualified' },
                          },
                      },
                      ...rest,
                  ] as Monaco.languages.IMonarchLanguageRule;
              })
            : root;

    // 2+3. Insert the new classification rules BEFORE the stock identifier
    // rule (or prepend when it was not found).
    const callRule: Monaco.languages.IMonarchLanguageRule = [
        /[a-zA-Z_]\w*(?=\s*\()/,
        {
            cases: {
                '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                await: { token: 'keyword.operator.await' },
                '@keywords': { token: 'keyword.$0' },
                '@default': { token: 'function', next: '@qualified' },
            },
        },
    ];
    const upperRule: Monaco.languages.IMonarchLanguageRule = [
        /[A-Z]\w*/,
        {
            cases: {
                '@namespaceFollows': { token: 'keyword.$0', next: '@namespace' },
                '@keywords': { token: 'keyword.$0' },
                '@default': { token: 'type.identifier', next: '@qualified' },
            },
        },
    ];
    const patchedRoot =
        identIndex >= 0
            ? insertRules(enrichedRoot, identIndex, callRule, upperRule)
            : [callRule, upperRule, ...enrichedRoot];

    const qualified = copyRules(tokenizer['qualified']);
    const patchedQualified: Monaco.languages.IMonarchLanguageRule[] = [
        [/[a-zA-Z_]\w*(?=\s*\()/, 'function'],
        [/[A-Z]\w*/, 'type.identifier'],
        ...qualified,
    ];

    return {
        ...lang,
        tokenizer: { ...tokenizer, root: patchedRoot, qualified: patchedQualified },
    };
}
