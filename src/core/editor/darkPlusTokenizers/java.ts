import type * as Monaco from 'monaco-editor';
import { copyRules, insertRules, type MonarchModule } from './shared';

/**
 * Java tokenizer shim — Dark+ fidelity patch over Monaco's stock `java.js`.
 *
 * Stock behavior: keywords are `keyword.<word>`; every other name is
 * `identifier` (`main`, `String`, `System`, `size` are indistinguishable).
 *
 * Changes (root state only):
 *  1. Call lookahead `word(?=\s*\()` → `function` (Dark+ pale yellow),
 *     keywords excluded via `@keywords` (so `if (`/`for (`/`while (` stay
 *     keywords; `new` is never directly followed by `(`).
 *  2. Uppercase-first words → `type.identifier` (Dark+ teal): class names,
 *     type references, `System`/`String`.
 *  3. `import`/`package` enter a path state that reproduces Dark+'s explicit
 *     rule coloring Java import/package identifiers in the editor foreground:
 *     `storage.modifier.import.java → #D4D4D4`. The path state mirrors the
 *     stock C# `namespace` state (whitespace include, dotted names, pop on
 *     anything else — including end of line — via the empty-match rule).
 *
 * Known approximation: `new Demo(` colors `Demo` yellow (call) instead of
 * teal; Monarch cannot see constructor context.
 */
const IMPORT_FOLLOWS = ['import', 'package'];

export function patchJavaLanguage(base: MonarchModule): Monaco.languages.IMonarchLanguage {
    const lang = base.language;
    const tokenizer = { ...lang.tokenizer };

    const callRule: Monaco.languages.IMonarchLanguageRule = [
        /[a-zA-Z_$][\w$]*(?=\s*\()/,
        {
            cases: {
                '@keywords': { token: 'keyword.$0' },
                '@default': 'function',
            },
        },
    ];
    const upperRule: Monaco.languages.IMonarchLanguageRule = [
        /[A-Z][\w$]*/,
        {
            cases: {
                '@keywords': { token: 'keyword.$0' },
                '@default': 'type.identifier',
            },
        },
    ];
    const importRule: Monaco.languages.IMonarchLanguageRule = [
        /[a-zA-Z_$][\w$]*/,
        {
            cases: {
                '@importFollows': { token: 'keyword.other.$0', next: '@importpath' },
                '@keywords': { token: 'keyword.$0' },
                '@default': 'identifier',
            },
        },
    ];

    const root = copyRules(tokenizer['root']);
    const identIndex = root.findIndex(
        (r) =>
            Array.isArray(r) &&
            r[0] instanceof RegExp &&
            r[0].source === '[a-zA-Z_$][\\w$]*',
    );
    const patchedRoot =
        identIndex >= 0
            ? insertRules(root, identIndex, callRule, upperRule, importRule)
            : [callRule, upperRule, importRule, ...root];

    const importpath: Monaco.languages.IMonarchLanguageRule[] = [
        { include: '@whitespace' },
        [/[a-zA-Z_$][\w$]*/, ''],
        [/[.*]/, 'delimiter'],
        [/\*/, ''],
        ['', '', '@pop'],
    ];

    return {
        ...lang,
        importFollows: IMPORT_FOLLOWS,
        tokenizer: { ...tokenizer, root: patchedRoot, importpath },
    };
}
