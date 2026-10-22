/**
 * Azemax Default model catalog.
 *
 * The list of models Azemax provides comes from the EXISTING backend
 * endpoint (`GET /api/ai/models`), which is the source of truth for the
 * server-configured providers and their labels. This module only fetches and
 * caches that list — it never invents models and never needs a credential.
 *
 * The default path deliberately does NOT go through the BYOK provider
 * adapters: Azemax Default is served by the backend, which holds the server
 * credentials. The browser never sees them.
 */

import { API_BASE } from '../../utils/apiClient';
import { authHeaders } from '../../utils/authToken';

export interface AzemaxDefaultModel {
    /** The model id sent to the backend. */
    id: string;
    /** Which server provider serves it. */
    provider: string;
    /** Human-readable label from the backend. */
    label: string;
    /** True for the backend's primary model. */
    primary?: boolean;
}

export interface DefaultModelCatalog {
    models: AzemaxDefaultModel[];
    /** When the catalog was fetched (epoch ms). */
    fetchedAt: number;
    /** Set when the fetch failed; the catalog is then empty. */
    error?: string;
}

const CACHE_TTL_MS = 60_000;

let cache: DefaultModelCatalog | null = null;
let inflight: Promise<DefaultModelCatalog> | null = null;

/** Drop the cached catalog (e.g. after an auth change). */
export function clearDefaultModelCache(): void {
    cache = null;
    inflight = null;
}

/**
 * Fetch the default model list from the backend.
 *
 * Never throws: a failure is reported through `error` so the UI can show a
 * useful message and offer Retry instead of an unhandled rejection.
 */
export async function fetchDefaultModels(force = false): Promise<DefaultModelCatalog> {
    if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache;
    }
    if (inflight) return inflight;

    inflight = (async (): Promise<DefaultModelCatalog> => {
        try {
            const response = await fetch(`${API_BASE}/ai/models`, {
                method: 'GET',
                credentials: 'include',
                headers: { Accept: 'application/json', ...authHeaders() },
            });
            if (!response.ok) {
                const catalog: DefaultModelCatalog = {
                    models: [],
                    fetchedAt: Date.now(),
                    error: `Could not load Azemax's models (HTTP ${response.status}).`,
                };
                cache = catalog;
                return catalog;
            }
            const body = await response.json();
            const raw: unknown[] = Array.isArray(body?.models) ? body.models : [];
            const models: AzemaxDefaultModel[] = raw
                .filter((m: unknown): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
                .map((m: Record<string, unknown>) => ({
                    id: String(m.id ?? ''),
                    provider: String(m.provider ?? ''),
                    label: String(m.label ?? m.id ?? ''),
                    primary: Boolean(m.primary),
                }))
                .filter((m: AzemaxDefaultModel) => m.id.length > 0);

            const catalog: DefaultModelCatalog = { models, fetchedAt: Date.now() };
            cache = catalog;
            return catalog;
        } catch (err) {
            const catalog: DefaultModelCatalog = {
                models: [],
                fetchedAt: Date.now(),
                error: err instanceof Error && err.message
                    ? `Could not reach the model service: ${err.message}`
                    : 'Could not reach the model service.',
            };
            cache = catalog;
            return catalog;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

/**
 * The model id used when the caller does not pick one.
 *
 * Mirrors the backend's own default so the browser and the backend agree on
 * the primary model. It is a MODEL ID, never a credential.
 */
export const FALLBACK_DEFAULT_MODEL_ID = 'nvidia/nemotron-3-super-120b-a12b';

/**
 * The best available default model: the backend's primary model when known,
 * otherwise the first entry, otherwise the built-in fallback id.
 */
export function pickDefaultModelId(catalog: DefaultModelCatalog | null): string {
    if (!catalog || catalog.models.length === 0) return FALLBACK_DEFAULT_MODEL_ID;
    const primary = catalog.models.find((m) => m.primary);
    return (primary ?? catalog.models[0]).id;
}
