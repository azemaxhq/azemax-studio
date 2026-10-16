import type * as Monaco from 'monaco-editor';

/**
 * Shared helpers for Azemax's Dark+-fidelity Monarch tokenizer shims.
 *
 * Each shim takes a stock Monaco `IMonarchLanguage` definition (loaded through
 * the language's OWN loader, so the tokenizer source stays identical to the
 * Monaco version the app runs) and returns a minimally patched copy:
 *
 *  1. Keyword emission is normalized to `keyword.<word>` (`keyword.$0`) so
 *     the theme can color Dark+ `keyword.control` scopes purple (#C586C0)
 *     while type/storage keywords stay blue (#569CD6).
 *  2. A call-site lookahead rule emits `function` for identifiers directly
 *     followed by `(` (Dark+ `entity.name.function`, #DCDCAA). Keywords are
 *     excluded through the same `@keywords` guard, so `if (` / `for (` /
 *     `while (` keep their keyword color.
 *
 * Design constraints (verified against Monarch in monaco-editor@0.55.1):
 *  - `cases` guards evaluate in insertion order; keyword guards come first.
 *  - `compile()` mutates the definition it receives, so every shim builds a
 *    FRESH object — the stock module-cached definition is never modified.
 *  - New rules are PREPENDED to existing states, never appended, so stock
 *    rules keep their relative order and states keep working when reached
 *    through `include` expansion (which inlines at compile time).
 */

export type MonarchModule = {
    conf?: unknown;
    language: Monaco.languages.IMonarchLanguage;
};

type Rule = Monaco.languages.IMonarchLanguageRule;
type Action = Monaco.languages.IMonarchLanguageAction;

/** Shallow-copy a rule list so the stock definition is never mutated. */
export function copyRules(rules: Rule[] | undefined): Rule[] {
    return [...(rules ?? [])];
}

/**
 * Rewrite `cases: { '@keywords': 'keyword', ... }` actions to emit
 * `keyword.$0` (the matched word). Rules that already emit something else
 * for `@keywords` are left untouched.
 *
 * NOTE: the replacement MUST use the object form `{ token: 'keyword.$0' }`.
 * Monarch only performs `$` substitution for object-form actions
 * (`tokenSubst` in monarchCompile); a bare string action `'keyword.$0'`
 * would be emitted literally.
 */
export function withWordKeywords(rules: Rule[]): Rule[] {
    return rules.map((rule) => {
        if (!Array.isArray(rule) || rule.length < 2) return rule;
        const action = rule[1] as Exclude<Action, string> | string;
        if (!action || typeof action !== 'object' || Array.isArray(action)) return rule;
        const cases = (action as { cases?: Record<string, unknown> }).cases;
        if (!cases || cases['@keywords'] !== 'keyword') return rule;
        const rest = rule.length > 2 ? [rule[2]] : [];
        return [rule[0], { ...action, cases: { ...cases, '@keywords': { token: 'keyword.$0' } } }, ...rest] as Rule;
    });
}

/** Non-mutating splice: insert `insert` at `index` of `rules`. */
export function insertRules(rules: Rule[], index: number, ...insert: Rule[]): Rule[] {
    const out = [...rules];
    out.splice(index, 0, ...insert);
    return out;
}
