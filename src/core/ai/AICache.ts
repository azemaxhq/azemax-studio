/**
 * Bounded caches for the AI runtime.
 *
 * Reused context (system prompts, project metadata, file summaries, model
 * resolution) is cached with a hard entry cap so repeated requests never
 * rebuild expensive strings. `BoundedCache` evicts the least-recently-used
 * entry past `maxEntries`.
 */

export class BoundedCache<K, V> {
    private map = new Map<K, V>();
    private readonly maxEntries: number;

    constructor(maxEntries: number) {
        this.maxEntries = maxEntries;
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // refresh recency
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    set(key: K, value: V): V {
        if (this.map.has(key)) this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.maxEntries) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) this.map.delete(oldest);
        }
        return value;
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    clear(): void {
        this.map.clear();
    }

    get size(): number {
        return this.map.size;
    }
}

/** Stable string hash (djb2) used to key caches without storing raw content. */
export function hashString(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}

// Singleton caches used across the runtime.
export const systemPromptCache = new BoundedCache<string, string>(16);
export const fileSummaryCache = new BoundedCache<string, string>(32);
export const modelResolutionCache = new BoundedCache<string, string>(16);