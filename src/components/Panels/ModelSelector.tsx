/**
 * ModelSelector — compact in-chat model picker for the composer.
 *
 * Shows the currently active AI model and mode (Azemax Default or BYOK).
 * Clicking it opens a lightweight popover with:
 *   • Current model indicator
 *   • Azemax Default section (Auto and individual models)
 *   • Configured BYOK providers grouped by provider
 *   • Search / filter across all available models
 *   • Manage Providers link → opens Settings → AI Providers
 *
 * The selector writes through the existing settings store (`ai.mode`,
 * `ai.azemaxModel`, `ai.activeProvider`, `ai.defaultModel`) and the ProviderContext so the
 * full AIClient → provider adapter pipeline picks up the change for all
 * subsequent requests. Active agent tasks retain their pinned
 * `providerTarget` and are never affected.
 */

import React, {
    useState,
    useRef,
    useCallback,
    useMemo,
    useEffect,
} from 'react';
import {
    ChevronDown,
    Search,
    Check,
    Cpu,
    Sparkles,
    ExternalLink,
    AlertCircle,
    Loader2,
    Zap,
    Eye,
    Wrench,
    X,
} from 'lucide-react';
import { useProvider } from '../../core/ai/providerContext';
import { providerRegistry } from '../../core/ai/providers/registry';
import { setAIMode } from '../../core/ai/byokRuntime';
import { useSetting, setSetting } from '../../settings/settingsStore';
import { AnchorPopover } from '../UI/AnchorPopover';
import {
    fetchDefaultModels,
    type AzemaxDefaultModel,
} from '../../core/ai/defaultModels';
import type { ProviderId, ModelInfo, ProviderValidationStatus } from '../../core/ai/byokTypes';
import type { AIProviderAdapter } from '../../core/ai/byokTypes';
import { sessionStore, encryptedStore } from '../../core/ai/credentialStore';
import { openAIProvidersSettings } from '../../core/ai/providerSettingsNav';

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Provider display names keyed by id */
const PROVIDER_LABELS: Record<ProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google Gemini',
    openrouter: 'OpenRouter',
    groq: 'Groq',
    nvidia: 'NVIDIA NIM',
    custom: 'Custom',
};

/** Short capability badges */
function capBadges(m: ModelInfo): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    if (m.capabilities.supportsToolCalling) {
        out.push(
            <span key="tool" className="az-model-badge" title="Tool calling">
                <Wrench size={9} /> Tools
            </span>,
        );
    }
    if (m.capabilities.supportsImages) {
        out.push(
            <span key="img" className="az-model-badge" title="Image input">
                <Eye size={9} /> Vision
            </span>,
        );
    }
    if (m.capabilities.supportsReasoning) {
        out.push(
            <span key="reason" className="az-model-badge" title="Extended reasoning">
                <Zap size={9} /> Reasoning
            </span>,
        );
    }
    if (m.contextWindow > 0) {
        const kCtx = Math.round(m.contextWindow / 1000);
        out.push(
            <span key="ctx" className="az-model-badge" title={`${m.contextWindow.toLocaleString()} token context`}>
                {kCtx}K
            </span>,
        );
    }
    return out;
}

/** Validation status dot color */
function statusColor(s: ProviderValidationStatus): string {
    switch (s) {
        case 'valid':
            return 'var(--az-success)';
        case 'testing':
            return 'var(--az-warning)';
        case 'invalid':
        case 'error':
        case 'rate_limited':
            return 'var(--az-error)';
        case 'unconfigured':
            return 'var(--az-text-muted)';
        default:
            return 'var(--az-text-faint)';
    }
}

/* ── Types ───────────────────────────────────────────────────────────── */

interface ConfiguredProvider {
    adapter: AIProviderAdapter;
    hasCredential: boolean;
}

export interface ModelSelectorProps {
    /** Called when the user clicks "Manage providers" — parent opens settings. */
    onOpenProviderSettings?: () => void;
}

/* ── Component ───────────────────────────────────────────────────────── */

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onOpenProviderSettings }) => {
    const provider = useProvider();
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>([]);
    const [isLoadingProviders, setIsLoadingProviders] = useState(false);
    const [defaultModels, setDefaultModels] = useState<AzemaxDefaultModel[]>([]);
    const [defaultModelsError, setDefaultModelsError] = useState<string | null>(null);
    const [isLoadingDefaultModels, setIsLoadingDefaultModels] = useState(false);

    // Reactive subscriptions to settings store
    const aiMode = useSetting<string>('ai.mode') ?? 'azemax-default';
    const currentAzemaxModel = useSetting<string>('ai.azemaxModel') ?? '';
    const currentByokProvider = useSetting<string>('ai.activeProvider') ?? '';
    const currentByokModel = useSetting<string>('ai.defaultModel') ?? '';

    const isDefault = aiMode === 'azemax-default';

    /**
     * Toggles the popover.
     */
    const toggleOpen = useCallback(() => {
        setOpen((v) => {
            const next = !v;
            if (next) {
                setIsLoadingProviders(true);
                setIsLoadingDefaultModels(true);
            } else {
                setSearchQuery('');
            }
            return next;
        });
    }, []);

    const btnRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    /* ── Determine the label for the button ───────────────────────────── */
    const buttonLabel = useMemo(() => {
        if (isDefault) {
            if (currentAzemaxModel) {
                const found = defaultModels.find((m) => m.id === currentAzemaxModel);
                if (found) {
                    return found.label.length > 28 ? `${found.label.slice(0, 26)}…` : found.label;
                }
                const shortId = currentAzemaxModel.split('/').pop() || currentAzemaxModel;
                return shortId.length > 28 ? `${shortId.slice(0, 26)}…` : shortId;
            }
            return 'Azemax Default';
        }
        if (provider.activeProvider && provider.activeModel) {
            const adapter = providerRegistry.get(provider.activeProvider);
            const modelInfo = adapter?.models.find((m) => m.id === provider.activeModel);
            if (modelInfo) return modelInfo.name;
            // Truncate long model ids
            const modelId = provider.activeModel;
            return modelId.length > 28 ? `${modelId.slice(0, 26)}…` : modelId;
        }
        if (provider.activeProvider) {
            return PROVIDER_LABELS[provider.activeProvider] || provider.activeProvider;
        }
        return 'Select Model';
    }, [isDefault, currentAzemaxModel, defaultModels, provider.activeProvider, provider.activeModel]);

    const buttonSublabel = useMemo(() => {
        if (isDefault) {
            return currentAzemaxModel ? 'Azemax Default' : null;
        }
        if (provider.activeProvider) {
            return PROVIDER_LABELS[provider.activeProvider] || null;
        }
        return null;
    }, [isDefault, currentAzemaxModel, provider.activeProvider]);

    /* ── Load configured providers when popover opens ─────────────────── */
    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        (async () => {
            const adapters = providerRegistry.getAll();
            const results: ConfiguredProvider[] = [];

            for (const adapter of adapters) {
                try {
                    const fromVault = await encryptedStore.getCredentials(adapter.id);
                    const fromSession = await sessionStore.getCredentials(adapter.id);
                    const config = fromVault || fromSession;
                    results.push({
                        adapter,
                        hasCredential: Boolean(config?.apiKey),
                    });
                } catch {
                    results.push({ adapter, hasCredential: false });
                }
            }

            if (!cancelled) {
                setConfiguredProviders(results);
                setIsLoadingProviders(false);
            }
        })();

        return () => { cancelled = true; };
    }, [open]);

    /* ── Load Azemax's default models on mount and when popover opens ──── */
    const loadDefaultModels = useCallback(async (force = false) => {
        setIsLoadingDefaultModels(true);
        try {
            const catalog = await fetchDefaultModels(force);
            setDefaultModels(catalog.models);
            setDefaultModelsError(catalog.error ?? null);
        } catch {
            setDefaultModelsError('Could not load models.');
        } finally {
            setIsLoadingDefaultModels(false);
        }
    }, []);

    useEffect(() => {
        void loadDefaultModels(false);
    }, [loadDefaultModels]);

    useEffect(() => {
        if (!open) return;
        void loadDefaultModels(false);
    }, [open, loadDefaultModels]);

    /* ── Focus search on open ─────────────────────────────────────────── */
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
    }, [open]);

    /* ── Close on Escape ──────────────────────────────────────────────── */
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (searchInputRef.current && e.target === searchInputRef.current) return;
            e.stopPropagation();
            setOpen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    /* ── Handlers ─────────────────────────────────────────────────────── */

    const selectAzemaxModel = useCallback((modelId: string) => {
        setAIMode('azemax-default');
        setSetting('ai.mode', 'azemax-default');
        setSetting('ai.azemaxModel', modelId);
        provider.setMode('azemax-default');
        setOpen(false);
    }, [provider]);

    const selectAzemaxDefault = useCallback(() => {
        selectAzemaxModel('');
    }, [selectAzemaxModel]);

    const selectByokModel = useCallback(
        async (providerId: ProviderId, modelId: string) => {
            // Switch to BYOK mode with the selected provider + model
            setAIMode('byok');
            setSetting('ai.mode', 'byok');
            setSetting('ai.activeProvider', providerId);
            setSetting('ai.defaultModel', modelId);
            await provider.setActiveProvider(providerId, modelId);
            provider.setMode('byok');
            setOpen(false);
        },
        [provider],
    );

    const handleManageProviders = useCallback(() => {
        setOpen(false);
        if (onOpenProviderSettings) {
            onOpenProviderSettings();
        } else {
            openAIProvidersSettings();
        }
    }, [onOpenProviderSettings]);

    /* ── Filter Azemax models ─────────────────────────────────────────── */
    const filteredAzemaxModels = useMemo(() => {
        if (!searchQuery.trim()) return defaultModels;
        const q = searchQuery.toLowerCase();
        return defaultModels.filter(
            m =>
                m.label.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q) ||
                (m.provider && m.provider.toLowerCase().includes(q)),
        );
    }, [defaultModels, searchQuery]);

    const showAzemaxDefaultCard = useMemo(() => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return 'azemax default'.includes(q) || 'server-managed ai'.includes(q);
    }, [searchQuery]);

    const showAzemaxSection = showAzemaxDefaultCard || filteredAzemaxModels.length > 0;

    /* ── Filter BYOK models ───────────────────────────────────────────── */
    const filteredProviders = useMemo(() => {
        if (!searchQuery.trim()) return configuredProviders;
        const q = searchQuery.toLowerCase();
        return configuredProviders
            .map(cp => {
                const nameMatch = cp.adapter.name.toLowerCase().includes(q);
                const matchingModels = cp.adapter.models.filter(
                    m =>
                        m.name.toLowerCase().includes(q) ||
                        m.id.toLowerCase().includes(q) ||
                        (m.description || '').toLowerCase().includes(q),
                );
                if (nameMatch || matchingModels.length > 0) {
                    return {
                        ...cp,
                        adapter: nameMatch
                            ? cp.adapter
                            : {
                                  ...cp.adapter,
                                  models: matchingModels,
                              },
                    };
                }
                return null;
            })
            .filter(Boolean) as ConfiguredProvider[];
    }, [configuredProviders, searchQuery]);

    const configuredWithKeys = filteredProviders.filter(cp => cp.hasCredential);
    const unconfiguredProviders = filteredProviders.filter(cp => !cp.hasCredential);

    /* ── Active checks ────────────────────────────────────────────────── */
    const isAzemaxDefaultActive = isDefault && (!currentAzemaxModel || currentAzemaxModel === '');
    const isAzemaxModelActive = (modelId: string) => isDefault && currentAzemaxModel === modelId;
    const isByokModelActive = (pId: ProviderId, mId: string) =>
        !isDefault && (provider.activeProvider === pId || currentByokProvider === pId) && (provider.activeModel === mId || currentByokModel === mId);

    const hasAnyResults = showAzemaxSection || configuredWithKeys.length > 0;

    /* ── Render ───────────────────────────────────────────────────────── */
    return (
        <div ref={btnRef} className="relative inline-flex items-center">
            {/* Trigger button */}
            <button
                onClick={toggleOpen}
                aria-expanded={open}
                aria-haspopup="listbox"
                title={`Model: ${buttonLabel}${buttonSublabel ? ` (${buttonSublabel})` : ''}`}
                aria-label="Select AI model"
                className={`hidden sm:inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-[6px] text-[11px] font-medium leading-none select-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15 ${open ? '!bg-white/[0.08] !text-[var(--az-text)]' : ''}`}
                style={{
                    background: open ? 'var(--az-surface-3)' : 'var(--az-surface-2)',
                    border: '1px solid var(--az-border)',
                    color: open
                        ? 'var(--az-text)'
                        : 'var(--az-text-secondary)',
                }}
            >
                <Cpu size={11} className="opacity-60 shrink-0" />
                <span className="truncate max-w-[120px]">{buttonLabel}</span>
                <ChevronDown
                    size={10}
                    strokeWidth={2}
                    className={`transition-transform ${open ? 'rotate-180' : ''}`}
                    style={{ opacity: 0.5 }}
                />
            </button>

            {/* Mobile trigger */}
            <button
                onClick={toggleOpen}
                aria-label="Select AI model"
                className="sm:hidden w-[26px] h-[26px] inline-flex items-center justify-center rounded-[6px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/15"
                style={{
                    color: open ? 'var(--az-text)' : 'var(--az-text-muted)',
                    background: open ? 'var(--az-surface-3)' : 'transparent',
                }}
            >
                <Cpu size={13} strokeWidth={1.75} />
            </button>

            {/* Popover */}
            <AnchorPopover
                open={open}
                anchorRef={btnRef}
                onClose={() => setOpen(false)}
                placement="auto"
                align="start"
                role="dialog"
                ariaLabel="Model selector"
                className="az-model-popover"
                dismissOnEscape={false}
                style={{
                    width: 320,
                    maxWidth: 'min(320px, calc(100vw - 24px))',
                }}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-3 py-2.5 shrink-0"
                    style={{
                        borderBottom: '1px solid var(--az-divider)',
                    }}
                >
                    <span
                        className="text-[12px] font-semibold tracking-wide"
                        style={{ color: 'var(--az-text-secondary)' }}
                    >
                        Select Model
                    </span>
                    <button
                        onClick={() => setOpen(false)}
                        className="p-1 rounded-md hover:bg-white/[0.06] transition-colors"
                        aria-label="Close model selector"
                        style={{ color: 'var(--az-text-muted)' }}
                    >
                        <X size={12} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-2.5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--az-divider)' }}>
                    <div
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px]"
                        style={{
                            background: 'var(--az-surface-2)',
                            border: '1px solid var(--az-border)',
                        }}
                    >
                        <Search size={12} style={{ color: 'var(--az-text-muted)' }} className="shrink-0" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search models…"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    if (searchQuery) {
                                        setSearchQuery('');
                                    } else {
                                        setOpen(false);
                                    }
                                }
                            }}
                            className="flex-1 bg-transparent text-[12px] text-[var(--az-text)] placeholder:text-[var(--az-text-muted)] focus:outline-none"
                            spellCheck={false}
                            autoComplete="off"
                        />
                    </div>
                </div>

                {/* Scrollable model list */}
                <div className="max-h-[360px] min-h-0 overflow-y-auto custom-scrollbar">
                    {/* Azemax Default Section */}
                    {showAzemaxSection && (
                        <div className="py-1.5">
                            <div className="px-3 pt-1 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--az-text-faint)' }}>
                                <Sparkles size={10} /> Azemax Default
                            </div>

                            {/* Azemax Default (Auto / Server-managed) card */}
                            {showAzemaxDefaultCard && (
                                <button
                                    onClick={selectAzemaxDefault}
                                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2.5 transition-colors ${isAzemaxDefaultActive ? 'bg-[var(--az-surface-3)]' : 'hover:bg-[var(--az-surface-hover)]'}`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <span
                                            className="w-6 h-6 rounded-[6px] flex items-center justify-center shrink-0 border"
                                            style={{
                                                background: isAzemaxDefaultActive ? 'var(--az-accent-soft)' : 'var(--az-surface-2)',
                                                borderColor: isAzemaxDefaultActive ? 'var(--az-accent-ring)' : 'var(--az-border)',
                                            }}
                                        >
                                            <Sparkles size={12} style={{ color: isAzemaxDefaultActive ? 'var(--az-accent)' : 'var(--az-text-muted)' }} />
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-[12.5px] font-medium leading-none" style={{ color: 'var(--az-text)' }}>
                                                Azemax Default
                                            </span>
                                            <span className="block text-[11px] leading-none mt-1" style={{ color: 'var(--az-text-muted)' }}>
                                                Server-managed AI · No API key needed
                                            </span>
                                        </span>
                                    </div>
                                    {isAzemaxDefaultActive && (
                                        <Check size={14} className="shrink-0" style={{ color: 'var(--az-accent)' }} />
                                    )}
                                </button>
                            )}

                            {/* Azemax models list */}
                            {isLoadingDefaultModels && defaultModels.length === 0 ? (
                                <div className="px-3 py-2 flex items-center gap-2">
                                    <Loader2 size={12} className="animate-spin" style={{ color: 'var(--az-text-muted)' }} />
                                    <span className="text-[11px]" style={{ color: 'var(--az-text-muted)' }}>
                                        Loading Azemax models…
                                    </span>
                                </div>
                            ) : defaultModelsError && defaultModels.length === 0 ? (
                                <div className="px-3 py-2 flex items-center gap-2">
                                    <AlertCircle size={12} className="shrink-0" style={{ color: 'var(--az-error)' }} />
                                    <span className="text-[11px] flex-1" style={{ color: 'var(--az-text-muted)' }}>
                                        {defaultModelsError}
                                    </span>
                                    <button
                                        onClick={() => { void loadDefaultModels(true); }}
                                        className="shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded"
                                        style={{ color: 'var(--az-accent)' }}
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : filteredAzemaxModels.length > 0 ? (
                                <div className="mt-0.5 space-y-0.5">
                                    {filteredAzemaxModels.map((m) => {
                                        const active = isAzemaxModelActive(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                onClick={() => selectAzemaxModel(m.id)}
                                                className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2.5 transition-colors ${active ? 'bg-[var(--az-surface-3)]' : 'hover:bg-[var(--az-surface-hover)]'}`}
                                            >
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span
                                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                                        style={{ background: active ? 'var(--az-accent)' : 'var(--az-text-faint)' }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5">
                                                            <span
                                                                className="text-[12px] font-medium leading-tight truncate"
                                                                style={{ color: active ? 'var(--az-text)' : 'var(--az-text-secondary)' }}
                                                            >
                                                                {m.label}
                                                            </span>
                                                            {m.primary && (
                                                                <span
                                                                    className="text-[9.5px] font-medium px-1 py-0.5 rounded leading-none shrink-0"
                                                                    style={{
                                                                        background: 'var(--az-surface-2)',
                                                                        color: 'var(--az-text-faint)',
                                                                        border: '1px solid var(--az-border)',
                                                                    }}
                                                                >
                                                                    primary
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                {active && (
                                                    <Check size={13} className="shrink-0" style={{ color: 'var(--az-accent)' }} />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {/* Loading */}
                    {isLoadingProviders && (
                        <div className="flex items-center justify-center py-6 gap-2">
                            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--az-text-muted)' }} />
                            <span className="text-[12px]" style={{ color: 'var(--az-text-muted)' }}>Loading providers…</span>
                        </div>
                    )}

                    {/* Configured providers with credentials (BYOK) */}
                    {!isLoadingProviders && configuredWithKeys.length > 0 && (
                        <div className="py-1.5" style={{ borderTop: '1px solid var(--az-divider)' }}>
                            <div className="px-3 pt-1 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--az-text-faint)' }}>
                                <Zap size={10} /> Your Providers
                            </div>
                            {configuredWithKeys.map(({ adapter }) => (
                                <div key={adapter.id}>
                                    {/* Provider group header */}
                                    <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
                                        <span
                                            className="w-1.5 h-1.5 rounded-full shrink-0"
                                            style={{
                                                background:
                                                    provider.activeProvider === adapter.id
                                                        ? statusColor(provider.validationStatus)
                                                        : 'var(--az-text-faint)',
                                            }}
                                        />
                                        <span className="text-[11px] font-medium" style={{ color: 'var(--az-text-secondary)' }}>
                                            {PROVIDER_LABELS[adapter.id] || adapter.name}
                                        </span>
                                    </div>
                                    {/* Models */}
                                    {adapter.models.map(model => {
                                        const active = isByokModelActive(adapter.id, model.id);
                                        return (
                                            <button
                                                key={`${adapter.id}-${model.id}`}
                                                onClick={() => selectByokModel(adapter.id, model.id)}
                                                className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2.5 transition-colors ${active ? 'bg-[var(--az-surface-3)]' : 'hover:bg-[var(--az-surface-hover)]'}`}
                                            >
                                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                                    <span
                                                        className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                                                        style={{ background: active ? 'var(--az-accent)' : 'var(--az-text-faint)' }}
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                        <span
                                                            className="block text-[12px] font-medium leading-tight truncate"
                                                            style={{ color: active ? 'var(--az-text)' : 'var(--az-text-secondary)' }}
                                                        >
                                                            {model.name}
                                                        </span>
                                                        {model.description && (
                                                            <span className="block text-[10.5px] leading-tight mt-0.5 truncate" style={{ color: 'var(--az-text-muted)' }}>
                                                                {model.description}
                                                            </span>
                                                        )}
                                                        {capBadges(model).length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {capBadges(model)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {active && (
                                                    <Check size={13} className="shrink-0 ml-2" style={{ color: 'var(--az-accent)' }} />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Unconfigured providers hint */}
                    {!isLoadingProviders && unconfiguredProviders.length > 0 && !searchQuery && (
                        <div className="py-1.5" style={{ borderTop: '1px solid var(--az-divider)' }}>
                            <button
                                onClick={handleManageProviders}
                                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-[var(--az-surface-hover)] transition-colors"
                            >
                                <span
                                    className="w-6 h-6 rounded-[6px] flex items-center justify-center shrink-0"
                                    style={{
                                        background: 'var(--az-surface-2)',
                                        border: '1px solid var(--az-border)',
                                    }}
                                >
                                    <ExternalLink size={11} style={{ color: 'var(--az-text-muted)' }} />
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[12px] font-medium leading-none" style={{ color: 'var(--az-text-secondary)' }}>
                                        Connect an AI Provider
                                    </span>
                                    <span className="block text-[10.5px] leading-none mt-1" style={{ color: 'var(--az-text-muted)' }}>
                                        {unconfiguredProviders.length} provider{unconfiguredProviders.length !== 1 ? 's' : ''} available
                                    </span>
                                </span>
                            </button>
                        </div>
                    )}

                    {/* Validation error for active provider */}
                    {!isDefault && provider.validationError && (
                        <div
                            className="mx-2.5 mb-2 px-2.5 py-2 rounded-[6px] flex items-start gap-2"
                            style={{
                                background: 'var(--az-error-soft)',
                                border: '1px solid var(--az-error-border)',
                            }}
                        >
                            <AlertCircle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--az-error)' }} />
                            <span className="text-[11px] leading-tight" style={{ color: 'var(--az-text-secondary)' }}>
                                {provider.validationError}
                            </span>
                        </div>
                    )}

                    {/* Empty search state */}
                    {!isLoadingProviders && searchQuery && !hasAnyResults && (
                        <div className="flex flex-col items-center py-6 gap-1.5">
                            <Search size={18} style={{ color: 'var(--az-text-faint)' }} />
                            <span className="text-[12px]" style={{ color: 'var(--az-text-muted)' }}>
                                No models match "{searchQuery}"
                            </span>
                        </div>
                    )}
                </div>

                {/* Footer: Manage providers */}
                <div
                    className="px-2.5 py-2 shrink-0"
                    style={{
                        borderTop: '1px solid var(--az-divider)',
                    }}
                >
                    <button
                        onClick={handleManageProviders}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[6px] text-[11px] font-medium hover:bg-white/[0.04] transition-colors"
                        style={{ color: 'var(--az-text-muted)' }}
                    >
                        <ExternalLink size={10} />
                        Manage Providers
                    </button>
                </div>
            </AnchorPopover>
        </div>
    );
};

export default ModelSelector;
