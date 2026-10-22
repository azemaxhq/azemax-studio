/**
 * AI mode resolution — the single source of truth for "who answers this
 * request?".
 *
 * Azemax supports two mutually exclusive modes:
 *
 *   azemax-default
 *       Azemax's own default models, served by the existing backend. No API
 *       key, no credential store, no provider adapter involved. This is the
 *       initial mode for every user.
 *
 *   byok
 *       The user's own provider credentials and preferred model, called
 *       directly from the browser with the user's key.
 *
 * The mode is an EXPLICIT preference, not a side effect of whether a key
 * happens to exist. Saving a key never changes the mode; the user has to
 * choose it. This is what makes the two modes independent: a user can keep a
 * saved key and still use Azemax Default, and a user who selects BYOK never
 * silently gets routed to the server.
 *
 * This module is React-free on purpose: `AIClient`, the agent loop and the
 * editor pipeline all depend on it, and none of them should have to pull in
 * the settings React tree.
 */

import { getSetting, setSetting } from '../../settings/settingsStore';
import { sessionStore, encryptedStore } from './credentialStore';
import { providerRegistry } from './providers/registry';
import type { ProviderConfig, ProviderId, ResolvedByokTarget } from './byokTypes';
import { AIError, AI_ERROR_CODES } from './AIError';

/** The two AI usage modes. */
export type AIMode = 'azemax-default' | 'byok';

export const AI_MODES: readonly AIMode[] = ['azemax-default', 'byok'] as const;

export function isAIMode(value: unknown): value is AIMode {
    return typeof value === 'string' && (AI_MODES as readonly string[]).includes(value);
}

/**
 * How ready the active mode is.
 *
 * `ready`            — the mode can serve requests.
 * `needs-credential` — BYOK is selected but no usable key is stored.
 * `unknown-provider` — BYOK is selected but the stored provider id is not a
 *                       provider this build knows about.
 */
export type AIModeStatus = 'ready' | 'needs-credential' | 'unknown-provider';

/** The provider ids that may be selected. `''` means "use the server default". */
export const BYOK_PROVIDER_IDS: readonly ProviderId[] = [
    'openai',
    'anthropic',
    'google',
    'openrouter',
    'groq',
    'nvidia',
    'custom',
] as const;

export function isProviderId(value: unknown): value is ProviderId {
    return typeof value === 'string' && value !== '' && (BYOK_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * The provider the user selected for BYOK, or `null` when none is selected.
 * This is independent of the mode: a provider can be selected while the
 * active mode is still `azemax-default`.
 */
export function getSelectedProviderId(): ProviderId | null {
    const raw = getSetting('ai.activeProvider');
    if (typeof raw !== 'string' || raw === '') return null;
    return isProviderId(raw) ? raw : null;
}

/**
 * The RAW stored provider id, without validating it against the known
 * provider list.
 *
 * Used to tell "no provider selected" apart from "the stored provider is no
 * longer available in this build" — the latter must surface a recoverable
 * configuration state instead of looking like a fresh install.
 */
export function getRawSelectedProviderId(): string {
    const raw = getSetting('ai.activeProvider');
    return typeof raw === 'string' ? raw : '';
}

/** The model the user selected for the active provider (may be empty). */
export function getSelectedModel(): string {
    const raw = getSetting('ai.defaultModel');
    return typeof raw === 'string' ? raw : '';
}

/**
 * The Azemax Default model the user selected (may be empty).
 *
 * This is a MODEL ID from the backend's own catalog — never a credential.
 * It is only sent to the backend, which owns the server credential.
 */
export function getSelectedAzemaxModel(): string {
    const raw = getSetting('ai.azemaxModel');
    return typeof raw === 'string' ? raw : '';
}

/**
 * The active AI mode.
 *
 * Defaults to `azemax-default`: a user who has never configured BYOK — and a
 * user who has configured it but never switched — uses Azemax's own models.
 */
export function getAIMode(): AIMode {
    const raw = getSetting('ai.mode');
    return isAIMode(raw) ? raw : 'azemax-default';
}

/** Switch the active mode. */
export function setAIMode(mode: AIMode): void {
    setSetting('ai.mode', mode);
}

/** True when the user has explicitly opted into their own provider. */
export function isByokMode(): boolean {
    return getAIMode() === 'byok';
}

/**
 * Whether a failed BYOK request may be retried against the server provider.
 * Off by default — the user must opt in.
 */
export function isServerFallbackAllowed(): boolean {
    return getSetting('ai.allowServerFallback') === true;
}

/**
 * A fully-resolved BYOK request target.
 *
 * `providerId` / `model` / `apiKey` are a snapshot: the caller must use these
 * values for the whole request (and any follow-up agent iteration) so a
 * concurrent settings change cannot alter the provider identity mid-task.
 */
export type { ResolvedByokTarget };

/**
 * The resolved active mode.
 *
 * `byokTarget` is populated ONLY in `byok` mode and only when the mode is
 * actually usable. `status` explains why it is missing.
 */
export interface ResolvedAIMode {
    mode: AIMode;
    status: AIModeStatus;
    /** The BYOK provider id (BYOK mode only). */
    providerId: ProviderId | null;
    /** The model to use (BYOK mode only). */
    model: string | null;
    /** The pinned target, when the mode is ready. */
    byokTarget: ResolvedByokTarget | null;
    /** User-facing explanation when `status !== 'ready'`. */
    message?: string;
}

/**
 * Look up the stored credential for a provider.
 *
 * The encrypted vault is consulted first so a remembered credential is found
 * after a reload; the session store covers the default (session-only) mode.
 */
async function findCredential(providerId: ProviderId): Promise<ProviderConfig | null> {
    const fromVault = await encryptedStore.getCredentials(providerId);
    if (fromVault) return fromVault;
    return sessionStore.getCredentials(providerId);
}

/**
 * Resolve the BYOK target for the current request.
 *
 * Returns `null` when BYOK is not the active mode (the Azemax Default path).
 * Throws a typed `AIError` when BYOK IS active but cannot be used — the
 * caller must surface that error, not fall back silently.
 */
export async function resolveByokTarget(): Promise<ResolvedByokTarget | null> {
    // Azemax Default: the backend owns the model and the credential. Nothing
    // BYOK-related is resolved, so the default path never depends on the
    // credential store being initialized.
    if (!isByokMode()) return null;

    // Read the RAW id so an id this build does not know about is reported
    // accurately ("unknown provider") rather than looking like a fresh
    // install ("no provider configured").
    const rawProviderId = getRawSelectedProviderId();
    if (!rawProviderId) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            retryable: false,
            message: 'Bring Your Own Key is selected but no provider is configured. Choose a provider in Settings → AI Providers.',
        });
    }

    if (!isProviderId(rawProviderId) || !providerRegistry.get(rawProviderId)) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: rawProviderId,
            retryable: false,
            message: `Unknown AI provider "${rawProviderId}". Choose another provider in Settings → AI Providers.`,
        });
    }

    const providerId = rawProviderId;
    const adapter = providerRegistry.get(providerId)!;

    const config = await findCredential(providerId);
    if (!config || !config.apiKey) {
        throw new AIError({
            code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
            provider: providerId,
            retryable: false,
            message: `No API key is configured for ${adapter.name}. Add one in Settings → AI Providers.`,
        });
    }

    const selectedModel = getSelectedModel();
    const model = selectedModel || config.model || adapter.defaultModel;

    return {
        providerId,
        model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        config: { ...config, model },
    };
}

/**
 * Resolve the active mode WITHOUT throwing.
 *
 * Used by the UI (settings, chat indicator) so it can render an actionable
 * state instead of an error. The request path uses `resolveByokTarget()`,
 * which throws a typed error.
 */
export async function resolveAIMode(): Promise<ResolvedAIMode> {
    const mode = getAIMode();
    if (mode === 'azemax-default') {
        return {
            mode,
            status: 'ready',
            providerId: null,
            model: null,
            byokTarget: null,
        };
    }

    const rawProviderId = getRawSelectedProviderId();
    if (!rawProviderId) {
        return {
            mode,
            status: 'needs-credential',
            providerId: null,
            model: null,
            byokTarget: null,
            message: 'Bring Your Own Key is selected but no provider is configured yet.',
        };
    }

    // A stored provider id this build does not know about (e.g. the provider
    // was removed in an update) must surface a recoverable state — not crash
    // and not silently look like "no provider selected".
    if (!isProviderId(rawProviderId) || !providerRegistry.get(rawProviderId)) {
        return {
            mode,
            status: 'unknown-provider',
            providerId: isProviderId(rawProviderId) ? rawProviderId : null,
            model: null,
            byokTarget: null,
            message: `The provider "${rawProviderId}" is not available in this build. Choose another provider.`,
        };
    }

    const providerId = rawProviderId;

    try {
        const target = await resolveByokTarget();
        if (target) {
            return {
                mode,
                status: 'ready',
                providerId: target.providerId,
                model: target.model,
                byokTarget: target,
            };
        }
    } catch (err) {
        return {
            mode,
            status: 'needs-credential',
            providerId,
            model: null,
            byokTarget: null,
            message: err instanceof AIError ? err.message : 'The provider could not be resolved.',
        };
    }

    return {
        mode,
        status: 'needs-credential',
        providerId,
        model: null,
        byokTarget: null,
        message: 'The provider is not configured yet.',
    };
}

/**
 * Build the provider-specific error for a BYOK request that could not run.
 */
export function byokConfigError(providerId: ProviderId, message: string): AIError {
    return new AIError({
        code: AI_ERROR_CODES.AI_PROVIDER_CONFIG_ERROR,
        provider: providerId,
        retryable: false,
        message,
    });
}
