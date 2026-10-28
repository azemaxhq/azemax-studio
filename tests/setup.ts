/**
 * Vitest isolation setup.
 *
 * Unit/integration tests must never depend on a developer's `.env` or on
 * real provider credentials. Vite loads `.env` for the test run, so a local
 * checkout with provider keys would silently exercise the direct-provider
 * fallback (and potentially the network) while CI — with no keys — takes a
 * different path.
 *
 * Clearing the browser-visible provider keys makes both environments take the
 * backend path deterministically. Tests that specifically exercise the direct
 * fallback opt in with `vi.stubEnv(...)` and a mocked `fetch`.
 *
 * Server-only credentials (`GROQ_API_KEY`, `NVIDIA_API_KEY`, …) are not
 * touched here: the server-router suites stub them explicitly when they need
 * a provider to be considered configured.
 */
import { afterEach, beforeEach, vi } from 'vitest';

const VITE_PROVIDER_KEYS = [
    'VITE_GROQ_API_KEY',
    'VITE_OPENROUTER_API_KEY',
    'VITE_HF_TOKEN',
    'VITE_KILO_API_KEY',
    'VITE_HF_BASE_URL',
] as const;

const clearDirectProviderEnv = () => {
    for (const key of VITE_PROVIDER_KEYS) {
        vi.stubEnv(key, '');
    }
    vi.stubEnv('VITE_USE_BACKEND_AI', 'true');
};

// Must run before the test module (and therefore AIClient/modelRouter) is
// imported, because those modules read import.meta.env at evaluation time.
clearDirectProviderEnv();

beforeEach(() => {
    clearDirectProviderEnv();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});
