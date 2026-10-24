/**
 * AI mode selector — the adaptive switch between Azemax Default and BYOK.
 *
 * Rendered inside the existing "AI" settings category. It follows the current
 * settings design language (same card/typography/spacing conventions) and
 * reuses the existing BYOK provider panel rather than duplicating it.
 *
 * Two modes:
 *   Azemax Default  — Azemax's own models, served by the existing backend.
 *                     No API key, no credential store, no provider adapter.
 *   Bring Your Own Key — the user's own provider credentials.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Sparkles,
    Key,
    CheckCircle2,
    AlertCircle,
    Loader2,
    RefreshCw,
    ChevronRight,
    ShieldCheck,
} from 'lucide-react';
import { useSetting, getSetting, setSetting } from '../../settings/settingsStore';
import { setAIMode, type AIMode } from '../../core/ai/byokRuntime';
import { fetchDefaultModels, pickDefaultModelId, type AzemaxDefaultModel } from '../../core/ai/defaultModels';
import { providerRegistry } from '../../core/ai/providers/registry';
import type { ProviderId } from '../../core/ai/byokTypes';
import { ProviderSetting } from './ProviderSettings';

const MODE_OPTIONS: Array<{
    id: AIMode;
    label: string;
    description: string;
    icon: React.ReactNode;
}> = [
    {
        id: 'azemax-default',
        label: 'Azemax Default',
        description: 'Use Azemax\u2019s available AI models. No API key required.',
        icon: <Sparkles size={13} />,
    },
    {
        id: 'byok',
        label: 'Bring Your Own Key',
        description: 'Connect your own AI provider and choose your preferred model.',
        icon: <Key size={13} />,
    },
];

/**
 * The default-model view: Azemax's own models, loaded from the existing
 * backend endpoint. Shows a real status (never a fabricated "Connected"),
 * a Retry action on failure, and a subtle route into the BYOK setup.
 */
const DefaultModeView: React.FC<{ onUseByok: () => void }> = ({ onUseByok }) => {
    const [models, setModels] = useState<AzemaxDefaultModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const storedModel = useSetting<string>('ai.azemaxModel') ?? '';
    const [selected, setSelected] = useState<string>(storedModel);

    useEffect(() => {
        if (storedModel) setSelected(storedModel);
    }, [storedModel]);

    /**
     * Fetch the catalog and apply it. `loading` starts as `true`, so the
     * initial load needs no synchronous setState (which would cause a
     * cascading render); the retry button flips it from an event handler.
     */
    const applyCatalog = useCallback((catalog: Awaited<ReturnType<typeof fetchDefaultModels>>) => {
        setModels(catalog.models);
        setError(catalog.error ?? null);
        const stored = getSetting('ai.azemaxModel');
        const storedStr = typeof stored === 'string' ? stored : '';
        if (storedStr && catalog.models.some(m => m.id === storedStr)) {
            setSelected(storedStr);
        } else {
            setSelected(pickDefaultModelId(catalog));
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void fetchDefaultModels().then((catalog) => {
            if (cancelled) return;
            applyCatalog(catalog);
        });
        return () => { cancelled = true; };
    }, [applyCatalog]);

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
                        <Sparkles size={13} />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-[12px] font-semibold text-white/85">Azemax models</h4>
                        <p className="text-[10.5px] text-white/40">Served by Azemax. No API key needed.</p>
                    </div>
                    <div className="ml-auto">
                        {loading ? (
                            <Loader2 size={13} className="text-white/40 animate-spin" aria-label="Loading models" />
                        ) : error ? (
                            <AlertCircle size={13} className="text-[var(--az-error)]" aria-label="Model list unavailable" />
                        ) : models.length > 0 ? (
                            <CheckCircle2 size={13} className="text-[var(--az-success)]" aria-label="Models available" />
                        ) : (
                            <AlertCircle size={13} className="text-[var(--az-warning)]" aria-label="No models available" />
                        )}
                    </div>
                </div>

                {error ? (
                    <div className="mt-3 flex items-center gap-2">
                        <p className="text-[11px] text-[var(--az-error)] leading-relaxed flex-1">{error}</p>
                        <button
                            type="button"
                            onClick={() => {
                                setLoading(true);
                                void fetchDefaultModels(true).then(applyCatalog);
                            }}
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-white/[0.12] bg-white/[0.06] text-white/70 hover:bg-white/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
                        >
                            <RefreshCw size={11} />
                            Retry
                        </button>
                    </div>
                ) : models.length > 0 ? (
                    <div className="mt-3">
                        <label htmlFor="azemax-default-model" className="block text-[11px] font-medium text-white/60 mb-1">
                            Model
                        </label>
                        <select
                            id="azemax-default-model"
                            value={selected}
                            onChange={(e) => {
                                const val = e.target.value;
                                setSelected(val);
                                setSetting('ai.azemaxModel', val);
                            }}
                            className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)] appearance-none"
                        >
                            {models.map((m) => (
                                <option key={m.id} value={m.id} className="bg-[#0D192B] text-white/80">
                                    {m.label}{m.primary ? ' — primary' : ''}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1.5 text-[10.5px] text-white/40">
                            {models.length} model{models.length === 1 ? '' : 's'} available. Usage is subject to Azemax&rsquo;s
                            account limits.
                        </p>
                    </div>
                ) : !loading ? (
                    <p className="mt-3 text-[11px] text-[var(--az-warning)] leading-relaxed">
                        No Azemax models are currently available. Try again later, or use your own provider.
                    </p>
                ) : null}
            </div>

            <button
                type="button"
                onClick={onUseByok}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] text-left hover:bg-white/[0.05] hover:border-white/[0.13] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
            >
                <Key size={13} className="text-white/40 shrink-0" />
                <span className="text-[11.5px] text-white/55 flex-1 min-w-0">
                    Use your own provider instead
                </span>
                <ChevronRight size={13} className="text-white/30 shrink-0" />
            </button>
        </div>
    );
};

/**
 * The BYOK view: the existing provider panel, plus the provider picker.
 */
const ByokModeView: React.FC = () => {
    const activeProvider = useSetting<string>('ai.activeProvider') ?? '';
    // The pending provider is derived state: the stored selection wins, and
    // the user's in-panel choice is the fallback until it is persisted.
    const [chosenProvider, setChosenProvider] = useState<ProviderId | null>(null);
    const pendingProvider: ProviderId =
        (activeProvider as ProviderId) || chosenProvider || 'openai';

    const providers = useMemo(
        () => providerRegistry.getAll().map((a) => ({ id: a.id, name: a.name })),
        [],
    );

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
                        <Key size={13} />
                    </div>
                    <div className="min-w-0">
                        <h4 className="text-[12px] font-semibold text-white/85">Your provider</h4>
                        <p className="text-[10.5px] text-white/40">Requests are sent straight to this provider with your key.</p>
                    </div>
                </div>

                <div className="mt-3">
                    <label htmlFor="byok-provider-select" className="block text-[11px] font-medium text-white/60 mb-1">
                        Provider
                    </label>
                    <select
                        id="byok-provider-select"
                        value={pendingProvider}
                        onChange={(e) => {
                            const next = e.target.value as ProviderId;
                            setChosenProvider(next);
                            // Choosing the provider inside BYOK mode is an
                            // explicit BYOK action, so it is persisted. It
                            // does not change the MODE (already 'byok').
                            setSetting('ai.activeProvider', next);
                        }}
                        className="w-full px-3 py-1.5 text-[12px] bg-white/[0.05] border border-white/[0.1] rounded-md text-white/80 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)] appearance-none"
                    >
                        {providers.map((p) => (
                            <option key={p.id} value={p.id} className="bg-[#0D192B] text-white/80">
                                {p.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="mt-3">
                    <ProviderSetting providerId={pendingProvider} />
                </div>
            </div>
        </div>
    );
};

export const AIModeSelector: React.FC = () => {
    const modeSetting = useSetting<string>('ai.mode');
    const mode: AIMode = modeSetting === 'byok' ? 'byok' : 'azemax-default';

    const handleSelect = useCallback((next: AIMode) => {
        setSetting('ai.mode', next);
        setAIMode(next);
    }, []);

    return (
        <div className="px-4 pt-3 pb-1 space-y-3">
            {/* Segmented control */}
            <div
                role="radiogroup"
                aria-label="AI mode"
                className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
                {MODE_OPTIONS.map((option) => {
                    const active = option.id === mode;
                    return (
                        <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => handleSelect(option.id)}
                            className={`text-left rounded-xl border px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] ${
                                active
                                    ? 'border-[rgba(91,140,255,0.45)] bg-[rgba(91,140,255,0.08)]'
                                    : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.13]'
                            }`}
                        >
                            <span className="flex items-center gap-2">
                                <span
                                    className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center ${
                                        active ? 'bg-[rgba(91,140,255,0.18)] text-[var(--az-text)]' : 'bg-white/[0.06] text-white/45'
                                    }`}
                                >
                                    {option.icon}
                                </span>
                                <span className={`text-[12px] font-semibold ${active ? 'text-white/95' : 'text-white/70'}`}>
                                    {option.label}
                                </span>
                                {active && (
                                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-[var(--az-text)]">
                                        Active
                                    </span>
                                )}
                            </span>
                            <span className="block mt-1 text-[10.5px] text-white/45 leading-relaxed">
                                {option.description}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Adaptive view */}
            {mode === 'byok' ? (
                <ByokModeView />
            ) : (
                <DefaultModeView onUseByok={() => handleSelect('byok')} />
            )}

            {mode === 'byok' && (
                <p className="flex items-start gap-1.5 text-[10.5px] text-white/40 leading-relaxed">
                    <ShieldCheck size={12} className="mt-px shrink-0 text-[rgba(91,140,255,0.6)]" />
                    <span>
                        Your key never leaves your browser. It is not stored in Azemax&rsquo;s settings, not synced to your
                        account, and never sent to Azemax&rsquo;s servers.
                    </span>
                </p>
            )}
        </div>
    );
};

export default AIModeSelector;
