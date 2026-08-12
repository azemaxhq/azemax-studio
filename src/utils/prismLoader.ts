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
            await Promise.all([
                import('prismjs/themes/prism-tomorrow.css'),
                import('prismjs/components/prism-typescript'),
                import('prismjs/components/prism-javascript'),
                import('prismjs/components/prism-jsx'),
                import('prismjs/components/prism-tsx'),
                import('prismjs/components/prism-css'),
                import('prismjs/components/prism-python'),
                import('prismjs/components/prism-json'),
            ]);
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
        return code;
    }
};
