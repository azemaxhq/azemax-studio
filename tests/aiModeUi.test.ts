/**
 * Adaptive provider-mode UI regression tests.
 *
 * The project has no DOM test renderer, so the UI guarantees are asserted
 * at the level they are actually decided:
 *
 *   • data/logic guarantees  → the mode resolver and the default-model
 *     catalog (deterministic, no DOM)
 *   • structural guarantees → the component source (theme tokens, responsive
 *     classes, no duplicated state) — these are the properties that
 *     regress silently when a component is edited.
 *
 * All provider responses here are MOCKED and every credential is FAKE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { setSetting, getSetting } from '../src/settings/settingsStore';
import { sanitizeSettings } from '../src/settings/settingsValidation';
import {
    getAIMode,
    setAIMode,
    isByokMode,
    resolveAIMode,
    getSelectedProviderId,
} from '../src/core/ai/byokRuntime';
import {
    fetchDefaultModels,
    pickDefaultModelId,
    clearDefaultModelCache,
    FALLBACK_DEFAULT_MODEL_ID,
} from '../src/core/ai/defaultModels';

const SRC = resolvePath(process.cwd(), 'src');

const readSource = (relative: string): string =>
    readFileSync(resolvePath(SRC, relative), 'utf8');

const originalFetch = globalThis.fetch;

beforeEach(() => {
    vi.clearAllMocks();
    clearDefaultModelCache();
    setSetting('ai.mode', 'azemax-default');
    setSetting('ai.activeProvider', '');
    setSetting('ai.defaultModel', '');
    setSetting('ai.azemaxModel', '');
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    setSetting('ai.mode', 'azemax-default');
    setSetting('ai.activeProvider', '');
    setSetting('ai.defaultModel', '');
    setSetting('ai.azemaxModel', '');
});

// ===========================================================================
// 25. Azemax Default displays the correct model selector
// ===========================================================================

describe('25. Azemax Default model selector', () => {
    it('populates from the backend catalog and preserves names and metadata', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
                models: [
                    { id: 'nvidia/nemotron-3-super-120b-a12b', provider: 'nvidia', label: 'Nemotron 3 Super 120B (NVIDIA)', primary: true },
                    { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B (Groq)' },
                ],
            }),
        }) as unknown as typeof fetch;

        const catalog = await fetchDefaultModels();
        expect(catalog.models).toHaveLength(2);
        // The names and metadata come straight from the backend.
        expect(catalog.models[0].label).toBe('Nemotron 3 Super 120B (NVIDIA)');
        expect(catalog.models[0].provider).toBe('nvidia');
        expect(catalog.models[1].label).toBe('Qwen 3.8 27B (Groq)');
        // The primary model is the default selection.
        expect(pickDefaultModelId(catalog)).toBe('nvidia/nemotron-3-super-120b-a12b');
    });

    it('falls back to the built-in default model id when the catalog is empty', () => {
        expect(pickDefaultModelId({ models: [], fetchedAt: Date.now() })).toBe(FALLBACK_DEFAULT_MODEL_ID);
    });

    it('reports a load failure instead of claiming models are available', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            headers: { get: () => null },
            json: async () => ({}),
        }) as unknown as typeof fetch;

        const catalog = await fetchDefaultModels();
        expect(catalog.models).toEqual([]);
        expect(catalog.error).toMatch(/HTTP 503/);
    });

    it('does not promise unlimited or free usage', () => {
        const source = readSource('components/Settings/AIModeSelector.tsx');
        expect(source).toMatch(/account limits/i);
        expect(source).not.toMatch(/unlimited/i);
        expect(source).not.toMatch(/\bfree\b(?!.*tier)/i);
    });
});

// ===========================================================================
// 26. BYOK displays its provider controls
// ===========================================================================

describe('26. BYOK provider controls', () => {
    it('resolves the BYOK provider and model for the active configuration', async () => {
        const { sessionStore } = await import('../src/core/ai/credentialStore');
        await sessionStore.setCredentials({
            id: 'anthropic', name: 'Anthropic', apiKey: 'sk-ant-fake-key',
            model: 'claude-3-5-sonnet-20241022', rememberOnDevice: false,
        });
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'anthropic');
        setSetting('ai.defaultModel', 'claude-3-5-sonnet-20241022');

        const resolved = await resolveAIMode();
        expect(resolved.mode).toBe('byok');
        expect(resolved.providerId).toBe('anthropic');
        expect(resolved.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('exposes the provider picker with every supported provider', () => {
        const source = readSource('components/Settings/AIModeSelector.tsx');
        // The provider list comes from the registry, so all seven are offered.
        expect(source).toMatch(/providerRegistry\.getAll\(\)/);
    });

    it('keeps the existing provider panel (no duplicate settings screen)', () => {
        const modeSelector = readSource('components/Settings/AIModeSelector.tsx');
        const providerSettings = readSource('components/Settings/ProviderSettings.tsx');
        // The BYOK view REUSES the existing panel instead of re-implementing it.
        expect(modeSelector).toMatch(/from '\.\/ProviderSettings'/);
        expect(modeSelector).toMatch(/<ProviderSetting/);
        // …and the panel is still the one with key entry, validation and the
        // encrypted-device option.
        expect(providerSettings).toMatch(/Test connection/i);
        expect(providerSettings).toMatch(/Remember on this device/i);
        expect(providerSettings).toMatch(/Remove/i);
    });
});

// ===========================================================================
// 27. Provider switching does not produce duplicate state
// ===========================================================================

describe('27. provider switching state', () => {
    it('keeps a single source of truth for the mode', () => {
        const runtime = readSource('core/ai/byokRuntime.ts');
        // The mode lives in exactly one place (the settings store) and the
        // resolver reads it — there is no second, competing store.
        expect(runtime).toMatch(/getSetting\('ai\.mode'\)/);
        expect(runtime).toMatch(/setSetting\('ai\.mode', mode\)/);
    });

    it('does not leave the provider selection duplicated between the mode and the panel', async () => {
        setSetting('ai.mode', 'byok');
        setSetting('ai.activeProvider', 'groq');
        // The mode and the provider are separate, non-duplicated facts.
        expect(getAIMode()).toBe('byok');
        expect(getSelectedProviderId()).toBe('groq');

        // Switching the mode does not change the provider.
        setAIMode('azemax-default');
        expect(getSelectedProviderId()).toBe('groq');
    });

    it('does not clear the provider configuration when the mode changes', () => {
        const source = readSource('components/Panels/ModelSelector.tsx');
        // The selector must not wipe `ai.activeProvider` when the user picks
        // Azemax Default — that would destroy the saved configuration.
        const defaultHandler = source.slice(
            source.indexOf('const selectAzemaxDefault'),
            source.indexOf('const selectByokModel'),
        );
        expect(defaultHandler).not.toMatch(/setSetting\('ai\.activeProvider', ''\)/);
        expect(defaultHandler).not.toMatch(/setSetting\('ai\.defaultModel', ''\)/);
    });
});

// ===========================================================================
// 28. Both views render correctly in the existing themes
// ===========================================================================

describe('28. theme consistency', () => {
    it('uses the existing theme tokens instead of hardcoded colours', () => {
        // The ONE exception is the native <option> background: native option
        // elements do not inherit CSS variables across browsers, and the
        // existing settings control uses the same literal (see
        // `SettingControl.tsx`).
        const OPTION_BACKGROUND = /bg-\[#0D192B\]/g;

        for (const file of [
            'components/Settings/AIModeSelector.tsx',
            'components/Settings/ProviderSettings.tsx',
            'components/Panels/ModelSelector.tsx',
        ]) {
            const source = readSource(file).replace(OPTION_BACKGROUND, '');
            expect(source, `${file} must not hardcode colours`).not.toMatch(/#[0-9a-fA-F]{6}\b/);
        }
    });

    it('uses the same CSS variables as the surrounding chat UI', () => {
        const source = readSource('components/Panels/ModelSelector.tsx');
        expect(source).toMatch(/var\(--az-text\)/);
        expect(source).toMatch(/var\(--az-accent\)/);
        expect(source).toMatch(/var\(--az-border\)/);
    });
});

// ===========================================================================
// 29. Responsive behaviour
// ===========================================================================

describe('29. responsive layout', () => {
    it('stacks the mode options vertically on narrow screens', () => {
        const source = readSource('components/Settings/AIModeSelector.tsx');
        // A single column by default, two columns from the `sm` breakpoint.
        expect(source).toMatch(/grid-cols-1 sm:grid-cols-2/);
    });

    it('keeps the model picker usable on narrow screens', () => {
        const source = readSource('components/Panels/ModelSelector.tsx');
        // A compact trigger on mobile, the full control from `sm` up, and the
        // popover is capped to the viewport width.
        expect(source).toMatch(/sm:hidden/);
        expect(source).toMatch(/hidden sm:inline-flex/);
        expect(source).toMatch(/maxWidth: 'min\(320px, calc\(100vw - 24px\)\)'/);
    });

    it('prevents API-key inputs from overflowing their container', () => {
        const source = readSource('components/Settings/ProviderSettings.tsx');
        expect(source).toMatch(/w-full/);
        expect(source).toMatch(/min-w-0/);
    });
});

// ===========================================================================
// 30. Existing unrelated settings remain functional
// ===========================================================================

describe('30. existing settings remain intact', () => {
    it('still round-trips the untouched setting categories', () => {
        const settings = sanitizeSettings(null);
        // Pre-existing categories are unaffected by the mode work.
        expect(settings.general.theme).toBe('dark');
        expect(settings.editor.fontSize).toBe(14);
        expect(settings.terminal.fontFamily).toContain('JetBrains Mono');
        expect(settings.ai.enabled).toBe(true);
        expect(settings.ai.streaming).toBe(true);
        expect(settings.ai.responseLength).toBe('medium');
        expect(settings.privacy.localPersistence).toBe(true);
    });

    it('does not persist any credential in the settings blob', () => {
        const settings = sanitizeSettings(null);
        const serialized = JSON.stringify(settings);
        expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
        // The provider fields are non-secret metadata only.
        expect(settings.ai.mode).toBe('azemax-default');
        expect(settings.ai.activeProvider).toBe('');
        expect(settings.ai.defaultModel).toBe('');
        expect(settings.ai.azemaxModel).toBe('');
    });

    it('keeps the AI Providers category without turning it into a persisted section', () => {
        const schema = readSource('settings/settingsSchema.ts');
        // The category exists (so it stays in the settings UI) …
        expect(schema).toMatch(/id: 'aiProviders'/);
        // … and declares no VALUE settings, so nothing secret can be persisted.
        const block = schema.slice(schema.indexOf("id: 'aiProviders'"));
        const category = block.slice(0, block.indexOf('\n  {', 10));
        expect(category).toMatch(/type: 'action'/);
        expect(category).not.toMatch(/type: 'text'/);
        expect(category).not.toMatch(/type: 'password'/);
    });
});
