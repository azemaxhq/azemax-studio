/**
 * Provider settings — the BYOK credential panel.
 *
 * Integrates with the existing Azemax settings architecture: it is rendered
 * inside the "AI Providers" settings category and reuses the panel styling
 * conventions of the surrounding settings UI.
 *
 * Credential policy enforced here:
 *   - The API key is NEVER written to the settings store (the settings blob
 *     is persisted to localStorage and synced to the account).
 *   - The key is held in component state while the user types and is pushed
 *     to the credential store (session-only, or AES-GCM encrypted) on save.
 *   - The key is never logged, never put in a URL, and never included in a
 *     diagnostic payload.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Eye,
    EyeOff,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Key,
    ExternalLink,
    Save,
    Trash2,
    Lock,
    ShieldCheck,
} from 'lucide-react';
import { providerRegistry, customProvider } from '../../core/ai/providers/registry';
import { sessionStore, encryptedStore, getStoreForConfig } from '../../core/ai/credentialStore';
import { evaluateEndpoint } from '../../core/ai/providers/endpointPolicy';
import type { ProviderConfig, ProviderId, ModelInfo } from '../../core/ai/byokTypes';
import { dialogAlert, dialogConfirm } from '../UI/dialogService';
import { setSetting, useSetting } from '../../settings/settingsStore';
import { registerActionHandler } from '../../settings/settingsSchema';
import { BYOK_PROVIDER_IDS, setAIMode } from '../../core/ai/byokRuntime';

interface ProviderMeta {
    name: string;
    keyUrl: string;
    keyFormat: string;
    models: Array<{ value: string; label: string }>;
    /** Whether the provider needs a user-supplied base URL. */
    needsBaseUrl?: boolean;
    /** Model is free text rather than a fixed list. */
    freeformModel?: boolean;
}

/**
 * Provider metadata.
 *
 * Model identifiers are taken from each provider's published model catalog.
 * A provider that supports dynamic discovery can still return a different
 * list at runtime (see `fetchModels`); this list is the offline fallback and
 * the set of identifiers the UI offers.
 */
const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
    openai: {
        name: 'OpenAI',
        keyUrl: 'https://platform.openai.com/api-keys',
        keyFormat: 'sk-...',
        models: [
            { value: 'gpt-4o', label: 'GPT-4o' },
            { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
            { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
            { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
        ],
    },
    anthropic: {
        name: 'Anthropic',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        keyFormat: 'sk-ant-...',
        models: [
            { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
            { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
            { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
        ],
    },
    google: {
        name: 'Google Gemini',
        keyUrl: 'https://aistudio.google.com/apikey',
        keyFormat: 'AIza...',
        models: [
            { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
            { value: 'gemini-1.0-pro', label: 'Gemini 1.0 Pro' },
        ],
    },
    openrouter: {
        name: 'OpenRouter',
        keyUrl: 'https://openrouter.ai/keys',
        keyFormat: 'sk-or-...',
        models: [
            { value: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super (Free)' },
            { value: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (Free)' },
            { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
            { value: 'openai/gpt-4o', label: 'GPT-4o' },
            { value: 'google/gemini-pro-1.5', label: 'Gemini 1.5 Pro' },
        ],
    },
    groq: {
        name: 'Groq',
        keyUrl: 'https://console.groq.com/keys',
        keyFormat: 'gsk_...',
        models: [
            { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
            { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
            { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
            { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
        ],
    },
    nvidia: {
        name: 'NVIDIA NIM',
        keyUrl: 'https://build.nvidia.com/',
        keyFormat: 'nvapi-...',
        models: [
            { value: 'nvidia/nemotron-3-ultra', label: 'Nemotron 3 Ultra' },
            { value: 'nvidia/nemotron-3-super', label: 'Nemotron 3 Super' },
            { value: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct' },
        ],
    },
    custom: {
        name: 'Custom OpenAI-Compatible',
        keyUrl: '',
        keyFormat: 'your-api-key',
        models: [],
        needsBaseUrl: true,
        freeformModel: true,
    },
};

// Registered at module scope so the settings schema can dispatch it. The
// action removes every stored credential from BOTH the session store and the
// encrypted vault, and clears the provider selection.
const clearAllCredentials = async (): Promise<void> => {
    const confirmed = await dialogConfirm({
        title: 'Remove All Credentials',
        message: 'Remove every stored provider API key from this device? The keys cannot be recovered.',
        confirmLabel: 'Remove all',
        cancelLabel: 'Cancel',
    });
    if (!confirmed) return;

    for (const id of BYOK_PROVIDER_IDS) {
        await sessionStore.removeCredentials(id);
        await encryptedStore.removeCredentials(id);
    }
    setSetting('ai.activeProvider', '');
    setSetting('ai.defaultModel', '');
    dialogAlert({ title: 'Removed', message: 'All stored provider credentials were removed.' });
};

registerActionHandler('aiProviders.clearAllCredentials', () => {
    void clearAllCredentials();
});

const PROVIDER_ORDER: ProviderId[] = [
    'openai',
    'anthropic',
    'google',
    'openrouter',
    'groq',
    'nvidia',
    'custom',
];

interface ProviderSettingProps {
    providerId: ProviderId;
    /** Notified when the credential / validation state changes. */
    onChanged?: (providerId: ProviderId) => void;
}

export const ProviderSetting: React.FC<ProviderSettingProps> = ({ providerId, onChanged }) => {
    const meta = PROVIDER_META[providerId];
    const adapter = providerRegistry.get(providerId);
    const activeProvider = useSetting<string>('ai.activeProvider') ?? '';

    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [model, setModel] = useState(meta.models[0]?.value ?? '');
    const [baseUrl, setBaseUrl] = useState('');
    const [rememberOnDevice, setRememberOnDevice] = useState(false);
    const [status, setStatus] = useState<'unknown' | 'testing' | 'valid' | 'invalid' | 'rate_limited' | 'error' | 'unconfigured'>('unknown');
    const [statusError, setStatusError] = useState<string | null>(null);
    const [isSaved, setIsSaved] = useState(false);
    const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);

    // Load the stored credential (masked — the key is only pre-filled when it
    // is still available in this session).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            let config = await encryptedStore.getCredentials(providerId);
            if (!config) config = await sessionStore.getCredentials(providerId);
            if (cancelled || !config) return;

            setIsSaved(true);
            setRememberOnDevice(Boolean(config.rememberOnDevice));
            if (config.model) setModel(config.model);
            if (config.baseUrl) setBaseUrl(config.baseUrl);
            // The key is only echoed back when it lives in the session store.
            if (config.apiKey) setApiKey(config.apiKey);
            setStatus(config.validationStatus ?? 'unknown');
            setStatusError(config.validationError ?? null);
        })();
        return () => {
            cancelled = true;
        };
    }, [providerId]);

    const modelChoices = useMemo(() => {
        if (discoveredModels.length) {
            return discoveredModels.map((m) => ({ value: m.id, label: m.name || m.id }));
        }
        return meta.models;
    }, [discoveredModels, meta.models]);

    const buildConfig = useCallback(
        (key: string): ProviderConfig => ({
            id: providerId,
            name: meta.name,
            apiKey: key,
            model: model || meta.models[0]?.value || '',
            baseUrl: providerId === 'custom' ? baseUrl.trim() : undefined,
            rememberOnDevice,
        }),
        [providerId, meta, model, baseUrl, rememberOnDevice],
    );

    const validateEndpointInput = useCallback((): boolean => {
        if (providerId !== 'custom') return true;
        if (!baseUrl.trim()) {
            dialogAlert({ title: 'Missing Base URL', message: 'Enter the base URL of your OpenAI-compatible endpoint.' });
            return false;
        }
        const decision = evaluateEndpoint(baseUrl.trim());
        if (!decision.ok) {
            dialogAlert({
                title: 'Endpoint Not Allowed',
                message: decision.message ?? 'This endpoint cannot be used.',
            });
            return false;
        }
        return true;
    }, [providerId, baseUrl]);

    const handleSave = useCallback(async () => {
        if (!apiKey.trim()) {
            dialogAlert({ title: 'Missing API Key', message: 'Enter an API key before saving.' });
            return;
        }
        if (!validateEndpointInput()) return;

        const config = buildConfig(apiKey.trim());

        if (config.rememberOnDevice) {
            // The encrypted vault must be unlocked before a key can be
            // persisted. The passphrase is never stored.
            if (!encryptedStore.isVaultUnlocked()) {
                const passphrase = window.prompt(
                    'Set a passphrase to encrypt this API key on this device.\n\nThe passphrase is never stored — you will need it to unlock the vault later.',
                );
                if (!passphrase) return;
                try {
                    await encryptedStore.initializeVault(passphrase);
                } catch (err) {
                    dialogAlert({
                        title: 'Vault Error',
                        message: err instanceof Error ? err.message : 'The credential vault could not be initialized.',
                    });
                    return;
                }
            }
        }

        const store = getStoreForConfig(config);
        try {
            await store.setCredentials(config);
        } catch (err) {
            dialogAlert({
                title: 'Could Not Save',
                message: err instanceof Error ? err.message : 'The credential could not be stored.',
            });
            return;
        }

        setIsSaved(true);
        // Keep the preferred model in sync with the model that was saved.
        if (activeProvider === providerId && config.model) {
            setSetting('ai.defaultModel', config.model);
        }
        onChanged?.(providerId);
        dialogAlert({ title: 'Saved', message: `${meta.name} credentials saved.` });
    }, [apiKey, validateEndpointInput, buildConfig, meta.name, providerId, activeProvider, onChanged]);

    const handleValidate = useCallback(async () => {
        if (!apiKey.trim()) {
            dialogAlert({ title: 'Missing API Key', message: 'Enter an API key before validating.' });
            return;
        }
        if (!validateEndpointInput()) return;

        setStatus('testing');
        setStatusError(null);

        const config = buildConfig(apiKey.trim());
        if (providerId === 'custom') customProvider.configure(config);

        try {
            const result = await adapter!.validateCredentials(config.apiKey, config.baseUrl);
            if (result.valid) {
                setStatus('valid');
                setStatusError(null);
                if (result.models && result.models.length) setDiscoveredModels(result.models);
            } else {
                setStatus(result.status);
                setStatusError(result.error || 'Validation failed');
            }
        } catch (err) {
            setStatus('error');
            setStatusError(err instanceof Error ? err.message : 'Validation failed');
        }
    }, [apiKey, validateEndpointInput, buildConfig, providerId, adapter]);

    const handleRemove = useCallback(async () => {
        const confirmed = await dialogConfirm({
            title: 'Remove Credentials',
            message: `Remove the stored ${meta.name} API key from this device?`,
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
        });
        if (!confirmed) return;

        await sessionStore.removeCredentials(providerId);
        await encryptedStore.removeCredentials(providerId);

        setApiKey('');
        setStatus('unknown');
        setStatusError(null);
        setIsSaved(false);
        setDiscoveredModels([]);
        onChanged?.(providerId);
    }, [providerId, meta.name, onChanged]);

    const statusIcon = useMemo(() => {
        switch (status) {
            case 'valid':
                return <CheckCircle2 size={15} className="text-[var(--az-success)]" />;
            case 'testing':
                return <Loader2 size={15} className="text-[var(--az-accent-bright)] animate-spin" />;
            case 'invalid':
            case 'error':
                return <AlertCircle size={15} className="text-[var(--az-error)]" />;
            case 'rate_limited':
                return <AlertCircle size={15} className="text-[var(--az-warning)]" />;
            default:
                return <AlertCircle size={15} className="text-white/30" />;
        }
    }, [status]);

    const statusLabel = useMemo(() => {
        switch (status) {
            case 'valid':
                return 'Connected';
            case 'testing':
                return 'Testing…';
            case 'invalid':
                return 'Invalid credentials';
            case 'rate_limited':
                return 'Rate limited';
            case 'error':
                return 'Error';
            case 'unconfigured':
                return 'Not configured';
            default:
                return 'Not tested';
        }
    }, [status]);

    return (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
                    <Key size={13} />
                </div>
                <div className="min-w-0">
                    <h4 className="text-[12px] font-semibold text-white/85">{meta.name}</h4>
                </div>
                <div className="ml-auto flex items-center gap-1.5" aria-live="polite">
                    {statusIcon}
                    <span className="text-[11px] text-white/50">{statusLabel}</span>
                </div>
            </div>

            <div className="mt-3 space-y-3">
                {/* API key */}
                <div>
                    <label htmlFor={`byok-key-${providerId}`} className="block text-[11px] font-medium text-white/60 mb-1">
                        API Key
                    </label>
                    <div className="relative">
                        <input
                            id={`byok-key-${providerId}`}
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={meta.keyFormat}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full px-3 py-1.5 pr-9 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 placeholder-white/30 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)]"
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-white/35 hover:text-white/80 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)]"
                            aria-label={showKey ? `Hide ${meta.name} API key` : `Show ${meta.name} API key`}
                            title={showKey ? 'Hide API key' : 'Show API key'}
                        >
                            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                    </div>
                    {meta.keyUrl && (
                        <a
                            href={meta.keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-[11px] text-[rgba(91,140,255,0.7)] hover:text-[var(--az-text)] transition-colors"
                        >
                            Get an API key <ExternalLink size={10} />
                        </a>
                    )}
                </div>

                {/* Base URL (custom provider only) */}
                {meta.needsBaseUrl && (
                    <div>
                        <label htmlFor={`byok-url-${providerId}`} className="block text-[11px] font-medium text-white/60 mb-1">
                            Base URL
                        </label>
                        <input
                            id={`byok-url-${providerId}`}
                            type="url"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder="https://api.example.com/v1"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 placeholder-white/30 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)]"
                        />
                        <p className="mt-1 text-[10.5px] text-white/40">
                            Must use https. Loopback and private-network addresses are rejected.
                        </p>
                    </div>
                )}

                {/* Model */}
                <div>
                    <label htmlFor={`byok-model-${providerId}`} className="block text-[11px] font-medium text-white/60 mb-1">
                        Model
                    </label>
                    {meta.freeformModel ? (
                        <input
                            id={`byok-model-${providerId}`}
                            type="text"
                            value={model}
                            onChange={(e) => {
                                const next = e.target.value;
                                setModel(next);
                                if (activeProvider === providerId) {
                                    setSetting('ai.defaultModel', next);
                                }
                            }}
                            placeholder="model-name"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 placeholder-white/30 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)]"
                        />
                    ) : (
                        <select
                            id={`byok-model-${providerId}`}
                            value={model}
                            onChange={(e) => {
                                const next = e.target.value;
                                setModel(next);
                                // The model of the ACTIVE provider is the
                                // preferred model for new requests.
                                if (activeProvider === providerId) {
                                    setSetting('ai.defaultModel', next);
                                }
                            }}
                            className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)] appearance-none"
                        >
                            {modelChoices.map((m) => (
                                <option key={m.value} value={m.value} className="bg-[#0D192B] text-white/80">
                                    {m.label}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Persistence policy */}
                <label className="flex items-start gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={rememberOnDevice}
                        onChange={(e) => setRememberOnDevice(e.target.checked)}
                        className="mt-0.5 w-3.5 h-3.5 rounded border-white/[0.2] bg-white/[0.05] accent-[var(--az-accent)]"
                    />
                    <span className="text-[11.5px] text-white/65 leading-relaxed">
                        Remember on this device
                        <span className="block text-[10.5px] text-white/40">
                            Encrypts the key with AES-GCM and stores it locally. Requires a passphrase to unlock.
                            Without this, the key is kept in memory for this session only.
                        </span>
                    </span>
                    {rememberOnDevice && <Lock size={12} className="mt-0.5 text-[rgba(91,140,255,0.7)] shrink-0" />}
                </label>

                {/* Status detail */}
                {statusError && (
                    <p className="text-[11px] text-[var(--az-error)] leading-relaxed" role="status">
                        {statusError}
                    </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-0.5">
                    <button
                        type="button"
                        onClick={handleValidate}
                        disabled={status === 'testing' || !apiKey.trim()}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-[rgba(91,140,255,0.25)] bg-[rgba(91,140,255,0.1)] text-[var(--az-text)] hover:bg-[rgba(91,140,255,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                        {status === 'testing' ? (
                            <>
                                <Loader2 size={11} className="inline-block animate-spin mr-1" />
                                Testing…
                            </>
                        ) : (
                            'Test connection'
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!apiKey.trim()}
                        style={{
                            background: 'var(--az-success-soft)',
                            border: '1px solid var(--az-success-border)',
                            color: 'var(--az-success)',
                        }}
                        className="px-2.5 py-1 text-[11px] font-medium rounded-md border hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                        <Save size={11} className="inline-block mr-1" />
                        Save
                    </button>

                    {isSaved && (
                        <button
                            type="button"
                            onClick={handleRemove}
                            className="ml-auto px-2.5 py-1 text-[11px] font-medium rounded-md border border-[rgba(255,125,139,0.25)] bg-[rgba(255,125,139,0.1)] text-[var(--az-error)] hover:bg-[rgba(255,125,139,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,125,139,0.4)] transition-colors"
                        >
                            <Trash2 size={11} className="inline-block mr-1" />
                            Remove
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

/**
 * The AI Providers settings page.
 */
export const ProviderSettingsPanel: React.FC = () => {
    // The selection lives in the settings store (non-secret metadata only) so
    // the request pipeline resolves the same provider the user picked here.
    const activeProvider = useSetting<string>('ai.activeProvider') ?? '';

    const handleProviderChange = useCallback((value: string) => {
        setSetting('ai.activeProvider', value);
        if (!value) setSetting('ai.defaultModel', '');
    }, []);

    return (
        <div className="px-4 pb-6 space-y-4">
            {/* Mode banner — the AI Providers page is the BYOK view, but the
                user must always be able to see which mode is actually active
                and switch back to Azemax Default without losing their saved
                provider configuration. */}
            <div
                className="rounded-xl border px-4 py-3"
                style={{
                    borderColor: activeProvider === 'byok'
                        ? 'rgba(91,140,255,0.28)'
                        : 'rgba(255,255,255,0.08)',
                    background: activeProvider === 'byok'
                        ? 'rgba(91,140,255,0.07)'
                        : 'rgba(255,255,255,0.02)',
                }}
            >
                <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-white/85">
                            {activeProvider === 'byok' ? 'Bring Your Own Key is active' : 'Azemax Default is active'}
                        </p>
                        <p className="text-[10.5px] text-white/45 leading-relaxed mt-0.5">
                            {activeProvider === 'byok'
                                ? 'Requests are sent to your provider with your key. Your saved configuration below stays intact when you switch modes.'
                                : 'Requests use Azemax\u2019s models. The providers you configure below are saved, but not used until you switch to Bring Your Own Key.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const next = activeProvider === 'byok' ? 'azemax-default' : 'byok';
                            setSetting('ai.mode', next);
                            setAIMode(next);
                        }}
                        className="shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[rgba(91,140,255,0.25)] bg-[rgba(91,140,255,0.1)] text-[var(--az-text)] hover:bg-[rgba(91,140,255,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
                    >
                        {activeProvider === 'byok' ? 'Use Azemax Default' : 'Use my provider'}
                    </button>
                </div>
            </div>

            {/* Active provider selector */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-7 h-7 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
                        <ShieldCheck size={13} />
                    </div>
                    <div>
                        <h3 className="text-[12px] font-semibold text-white/85">Active AI Provider</h3>
                        <p className="text-[10.5px] text-white/40">Requests use this provider and your own credentials.</p>
                    </div>
                </div>

                <select
                    value={activeProvider}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    aria-label="Active AI provider"
                    className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)] appearance-none"
                >
                    <option value="">Use Server Default</option>
                    {PROVIDER_ORDER.map((id) => (
                        <option key={id} value={id} className="bg-[#0D192B] text-white/80">
                            {PROVIDER_META[id].name}
                        </option>
                    ))}
                </select>

                {activeProvider && (
                    <p className="mt-2 text-[10.5px] text-white/45 leading-relaxed">
                        Requests run on <strong className="text-white/70">{PROVIDER_META[activeProvider as ProviderId].name}</strong> using the
                        credential you store below. A failed request is reported as an error — it is never retried
                        against a different provider unless you enable the server fallback in Settings → AI.
                    </p>
                )}
            </div>

            {/* Per-provider credential cards */}
            <div className="space-y-3">
                {PROVIDER_ORDER.map((id) => (
                    <ProviderSetting key={id} providerId={id} />
                ))}
            </div>

            {/* Storage policy explainer */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 shrink-0 rounded-lg bg-[rgba(240,198,116,0.1)] border border-[rgba(240,198,116,0.2)] flex items-center justify-center text-[rgba(240,198,116,0.9)]">
                        <Lock size={13} />
                    </div>
                    <h4 className="text-[12px] font-semibold text-white/85">How your key is stored</h4>
                </div>
                <ul className="mt-2.5 space-y-1.5 text-[11px] text-white/50 leading-relaxed list-disc pl-4">
                    <li>By default the key is kept in memory for this session only — it is never written to disk.</li>
                    <li>
                        &ldquo;Remember on this device&rdquo; encrypts it with AES-GCM using a passphrase-derived key and stores the
                        ciphertext in IndexedDB. The passphrase and the derived key are never stored.
                    </li>
                    <li>
                        Browser encryption protects the data at rest. It does not protect against malicious script running
                        inside an unlocked session, and JavaScript cannot guarantee memory erasure.
                    </li>
                </ul>

                <button
                    type="button"
                    onClick={() => { void clearAllCredentials(); }}
                    className="mt-3 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[rgba(255,125,139,0.25)] bg-[rgba(255,125,139,0.1)] text-[var(--az-error)] hover:bg-[rgba(255,125,139,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(255,125,139,0.4)] transition-colors"
                >
                    <Trash2 size={11} className="inline-block mr-1" />
                    Remove all stored credentials
                </button>
            </div>
        </div>
    );
};

export default ProviderSettingsPanel;
