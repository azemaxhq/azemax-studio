import type * as Monaco from 'monaco-editor';
import { copyRules, withWordKeywords, type MonarchModule } from './shared';

/**
 * TypeScript/JavaScript tokenizer shim — Dark+ fidelity patch over Monaco's
 * stock `typescript.js` (which `javascript.js` reuses verbatim).
 *
 * Stock behavior: identifiers that start uppercase are already
 * `type.identifier` (constructors, class names, `React`); everything else is
 * `identifier`, and keywords emit bare `keyword`.
 *
 * Changes (shared `common` state, which `root` and `bracketCounting` include):
 *  1. Call lookahead for lowercase words `word(?=\s*\()` → `function`
 *     (Dark+ pale yellow): `greet(`, `main(`, `render(`, `console.log(`'s
 *     `log`. Uppercase words keep the stock `type.identifier` (Dark+ teal),
 *     which is also what constructors (`new Service(`) need.
 *  2. Keyword emission normalized from bare `keyword` to `keyword.$0` so
 *     control keywords (`if`, `for`, `return`, `new`, `await`, …) resolve to
 *     the theme's purple control rules while type/storage keywords
 *     (`const`, `class`, `function`, `true`, …) stay blue.
 *
 * The `common` array is rebuilt (never mutated in place) because the stock
 * `javascript` and `typescript` modules share one tokenizer object; each
 * language's factory clones before patching so the two never interfere.
 */
export function patchTypeScriptLanguage(base: MonarchModule): Monaco.languages.IMonarchLanguage {
    const lang = base.language;
    const tokenizer = { ...lang.tokenizer };

    const callRule: Monaco.languages.IMonarchLanguageRule = [
        /[a-z_$][\w$]*(?=\s*\()/,
        {
            cases: {
                '@keywords': { token: 'keyword.$0' },
                '@default': 'function',
            },
        },
    ];

    const common = withWordKeywords(copyRules(tokenizer['common']));

    return {
        ...lang,
        tokenizer: { ...tokenizer, common: [callRule, ...common] },
    };
}

/** JavaScript shares TypeScript's tokenizer; same patch applies. */
export function patchJavaScriptLanguage(base: MonarchModule): Monaco.languages.IMonarchLanguage {
    return patchTypeScriptLanguage(base);
}
