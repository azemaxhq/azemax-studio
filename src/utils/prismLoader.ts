type PrismStatic = typeof import('prismjs');

let prism: PrismStatic | null = null;
let promise: Promise<PrismStatic> | null = null;

// Bounded LRU-ish cache: during streaming the same code block is re-highlighted
// on every token, so identical inputs should skip the synchronous Prism pass.
const HIGHLIGHT_CACHE = new Map<string, string>();
const MAX_HIGHLIGHT_CACHE = 50;

export const getPrism = (): PrismStatic | null => prism;

export const loadPrism = (): Promise<PrismStatic> => {
    if (!promise) {
        promise = (async () => {
            const mod = await import('prismjs');
            const P: PrismStatic = mod.default ?? mod;
            // Prism component scripts mutate the global `Prism`, so make sure it
            // exists before any language component is evaluated.
            (globalThis as unknown as { Prism?: PrismStatic }).Prism = P;
            // Stylesheet is independent — load it in parallel with the grammars.
            const cssReady = import('prismjs/themes/prism-tomorrow.css');
            // Language components MUST load in dependency order. Each component
            // extends a parent grammar (tsx → jsx → javascript → clike;
            // php → markup-templating; markdown → markup). The previous
            // Promise.all raced these, so dependents sometimes ran before their
            // parent existed and threw
            // "Cannot set properties of undefined (setting 'comment')",
            // which rejected the whole load and silently disabled highlighting.
            const loaders: Array<() => Promise<unknown>> = [
                () => import('prismjs/components/prism-markup'),
                () => import('prismjs/components/prism-markup-templating'),
                () => import('prismjs/components/prism-css'),
                () => import('prismjs/components/prism-clike'),
                () => import('prismjs/components/prism-javascript'),
                () => import('prismjs/components/prism-typescript'),
                () => import('prismjs/components/prism-jsx'),
                () => import('prismjs/components/prism-tsx'),
                () => import('prismjs/components/prism-json'),
                () => import('prismjs/components/prism-python'),
                () => import('prismjs/components/prism-bash'),
                () => import('prismjs/components/prism-c'),
                () => import('prismjs/components/prism-cpp'),
                () => import('prismjs/components/prism-csharp'),
                () => import('prismjs/components/prism-java'),
                () => import('prismjs/components/prism-go'),
                () => import('prismjs/components/prism-rust'),
                () => import('prismjs/components/prism-ruby'),
                () => import('prismjs/components/prism-php'),
                () => import('prismjs/components/prism-swift'),
                () => import('prismjs/components/prism-kotlin'),
                () => import('prismjs/components/prism-scala'),
                () => import('prismjs/components/prism-sql'),
                () => import('prismjs/components/prism-yaml'),
                () => import('prismjs/components/prism-toml'),
                () => import('prismjs/components/prism-markdown'),
                () => import('prismjs/components/prism-graphql'),
                () => import('prismjs/components/prism-docker'),
                () => import('prismjs/components/prism-ini'),
                () => import('prismjs/components/prism-powershell'),
            ];
            for (const load of loaders) await load();
            await cssReady;
            prism = P;
            return P;
        })();
    }
    return promise;
};

export const tryHighlight = (code: string, language: string): string | null => {
    if (!prism) return null;
    const key = `${language}\u0000${code}`;
    const cached = HIGHLIGHT_CACHE.get(key);
    if (cached !== undefined) return cached;
    try {
        const result = prism.highlight(
            code,
            prism.languages[language] || prism.languages.typescript,
            language
        );
        if (HIGHLIGHT_CACHE.size >= MAX_HIGHLIGHT_CACHE) {
            HIGHLIGHT_CACHE.delete(HIGHLIGHT_CACHE.keys().next().value as string);
        }
        HIGHLIGHT_CACHE.set(key, result);
        return result;
    } catch {
        // Security: NEVER return raw input here — callers inject the result
        // via dangerouslySetInnerHTML. Null degrades to the escaped plain-text
        // branch at every call site.
        return null;
    }
};
