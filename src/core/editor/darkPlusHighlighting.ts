import type * as Monaco from 'monaco-editor';
import { defineAzemaxDarkPlusTheme, AZEMAX_DARKPLUS_THEME_ID } from './azemaxDarkPlusTheme';
import { patchCSharpLanguage } from './darkPlusTokenizers/csharp';
import { patchJavaLanguage } from './darkPlusTokenizers/java';
import { patchPythonLanguage } from './darkPlusTokenizers/python';
import { patchJavaScriptLanguage, patchTypeScriptLanguage } from './darkPlusTokenizers/typescript';
import type { MonarchModule } from './darkPlusTokenizers/shared';

/**
 * Dark+ syntax-highlighting setup for Azemax's Monaco instance.
 *
 * Two parts, applied once per Monaco instance (called from
 * `handleEditorBeforeMount`, i.e. before @monaco-editor/react creates the
 * editor and calls `setTheme`):
 *
 *  1. `setupAzemaxDarkPlusTheme` — registers the `azemax-midnight-signature`
 *     theme whose token rules reproduce VS Code Dark+ (`dark_plus.json` over
 *     `dark_vs.json`) on Azemax's Midnight Blue background. It is the single
 *     authoritative syntax-theme definition; no other `defineTheme` call for
 *     editor tokens should exist.
 *  2. `setupDarkPlusTokenizers` — installs per-language Monarch tokenizer
 *     shims through `registerTokensProviderFactory`. Each factory awaits the
 *     language's OWN loader (`getLanguages().find(l => l.id).loader`) and
 *     returns a minimally patched copy of the stock definition, so:
 *       - the tokenizer source stays identical to the running Monaco build;
 *       - no eager/lazy language-loading race: `registerTokensProviderFactory`
 *         disposes the previous factory, so the shim always wins whether the
 *         language was already loaded or loads later;
 *       - no eager imports of every language (factories resolve lazily when
 *         a model of that language is first tokenized).
 *
 * No semantic-token providers are registered: Monaco standalone ships none
 * for these languages, so there is no semantic layer to override the theme.
 * If a provider is added in the future it must map to Dark+'s
 * `semanticTokenColors` (numberLiteral #b5cea8, stringLiteral #ce9178,
 * newOperator #C586C0, customLiteral #DCDCAA).
 */

type PatchFn = (base: MonarchModule) => Monaco.languages.IMonarchLanguage;

const PATCHES: Record<string, PatchFn> = {
    csharp: patchCSharpLanguage,
    java: patchJavaLanguage,
    python: patchPythonLanguage,
    typescript: patchTypeScriptLanguage,
    javascript: patchJavaScriptLanguage,
};

type LanguageExtensionPoint = Monaco.languages.ILanguageExtensionPoint & {
    loader?: () => Promise<MonarchModule>;
};

let setupDoneFor: WeakSet<object> | null = null;

function monacoSetupDone(monaco: typeof Monaco): boolean {
    if (!setupDoneFor) setupDoneFor = new WeakSet();
    if (setupDoneFor.has(monaco)) return true;
    setupDoneFor.add(monaco);
    return false;
}

export function setupAzemaxDarkPlusTheme(monaco: typeof Monaco): void {
    defineAzemaxDarkPlusTheme(monaco);
}

export function setupDarkPlusTokenizers(monaco: typeof Monaco): void {
    for (const [languageId, patch] of Object.entries(PATCHES)) {
        try {
            const entry = monaco.languages
                .getLanguages()
                .find((l) => l.id === languageId) as LanguageExtensionPoint | undefined;
            const loader = entry?.loader;
            if (typeof loader !== 'function') continue;
            monaco.languages.registerTokensProviderFactory(languageId, {
                create: async () => {
                    const mod = await loader();
                    if (!mod || !mod.language || !mod.language.tokenizer) return null;
                    return patch(mod);
                },
            });
        } catch {
            // Never break editor startup because of a tokenizer shim: the
            // stock Monaco tokenizer remains in place as the fallback.
        }
    }
}

/** Idempotent one-shot: theme + tokenizer shims for a Monaco instance. */
export function setupAzemaxDarkPlusHighlighting(monaco: typeof Monaco): void {
    if (monacoSetupDone(monaco)) return;
    setupAzemaxDarkPlusTheme(monaco);
    setupDarkPlusTokenizers(monaco);
}

export { AZEMAX_DARKPLUS_THEME_ID };
