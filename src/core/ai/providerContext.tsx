/* eslint-disable react-refresh/only-export-components */
/**
 * Provider Context — the React view over the BYOK credential store.
 *
 * This module owns the UI-facing state (which provider is selected, its
 * validation status, whether the device vault is unlocked). It does NOT own
 * request routing: `byokRuntime.ts` resolves the target for an actual AI
 * request, so the agent loop and the editor pipeline never depend on React.
 *
 * API keys are never written to the settings store. The settings blob is
 * persisted to localStorage and synced to the account, so a key stored there
 * would be written in plaintext. Credentials live only in the credential
 * store (session-only by default, AES-GCM encrypted at rest when the user
 * opts in).
 */

import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useMemo,
    useRef,
} from 'react';
import type { ProviderConfig, ProviderId, ProviderValidationStatus, ModelInfo } from './byokTypes';
import { providerRegistry, customProvider } from './providers/registry';
import { sessionStore, encryptedStore, getStoreForConfig } from './credentialStore';
import { getSetting, setSetting, subscribeSettings } from '../../settings/settingsStore';
import { isProviderId, getAIMode, setAIMode, type AIMode } from './byokRuntime';

interface ProviderContextType {
    // State
    /** The active AI mode: `azemax-default` or `byok`. */
    mode: AIMode;
    activeProvider: ProviderId | null;
    activeConfig: ProviderConfig | null;
    activeModel: string | null;
    validationStatus: ProviderValidationStatus;
    validationError: string | null;
    isValidating: boolean;
    availableModels: ModelInfo[];

    // Actions
    /**
     * Switch the active AI mode.
     *
     * Switching to BYOK without a usable credential leaves the mode in a
     * recoverable "needs setup" state — it never silently routes requests to
     * a different provider.
     */
    setMode: (mode: AIMode) => void;
    setActiveProvider: (providerId: ProviderId | null, model?: string) => Promise<void>;
    validateProvider: (providerId: ProviderId, apiKey: string, baseUrl?: string, rememberOnDevice?: boolean) => Promise<boolean>;
    fetchModels: (providerId: ProviderId, apiKey: string, baseUrl?: string) => Promise<ModelInfo[]>;
    removeProvider: (providerId: ProviderId) => Promise<void>;
    updateProviderConfig: (config: ProviderConfig) => Promise<void>;

    // Encrypted vault
    unlockVault: (passphrase: string) => Promise<boolean>;
    lockVault: () => void;
    isVaultUnlocked: boolean;
    initializeVault: (passphrase: string) => Promise<void>;
}

const ProviderContext = createContext<ProviderContextType | undefined>(undefined);

export const useProvider = (): ProviderContextType => {
    const context = useContext(ProviderContext);
    if (!context) {
        throw new Error('useProvider must be used within a ProviderProvider');
    }
    return context;
};

interface ProviderProviderProps {
    children: React.ReactNode;
}

export const ProviderProvider: React.FC<ProviderProviderProps> = ({ children }) => {
    const [mode, setModeState] = useState<AIMode>(() => getAIMode());
    const [activeProvider, setActiveProviderState] = useState<ProviderId | null>(null);
    const [activeConfig, setActiveConfigState] = useState<ProviderConfig | null>(null);
    const [activeModel, setActiveModelState] = useState<string | null>(null);
    const [validationStatus, setValidationStatus] = useState<ProviderValidationStatus>('unknown');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
    const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);

    const validatingProviderRef = useRef<ProviderId | null>(null);
    const initRef = useRef(false);

    const persistConfig = useCallback(async (config: ProviderConfig) => {
        const store = getStoreForConfig(config);
        await store.setCredentials(config);
    }, []);

    const activateProvider = useCallback(async (providerId: ProviderId, model?: string) => {
        if (!providerId) return;

        try {
            // The encrypted vault is consulted first so a remembered
            // credential is found after a reload.
            let config = await encryptedStore.getCredentials(providerId);
            if (!config) config = await sessionStore.getCredentials(providerId);

            const adapter = providerRegistry.get(providerId);
            if (!adapter) return;

            if (!config || !config.apiKey) {
                // Provider selected but no credential yet: the panel shows
                // "Not configured" and requests fail with a config error.
                const placeholder: ProviderConfig = {
                    id: providerId,
                    name: adapter.name,
                    apiKey: '',
                    model: model || adapter.defaultModel,
                    rememberOnDevice: false,
                };
                setActiveProviderState(providerId);
                setActiveConfigState(placeholder);
                setActiveModelState(placeholder.model);
                setAvailableModels(adapter.models);
                setValidationStatus('unconfigured');
                setValidationError(null);
                return;
            }

            if (providerId === 'custom' && config.baseUrl) {
                customProvider.configure(config);
            }

            const finalModel = model || config.model || adapter.defaultModel;
            setActiveProviderState(providerId);
            setActiveConfigState(config);
            setActiveModelState(finalModel);
            setAvailableModels(adapter.models);

            // Validate the stored credential so the panel can show an honest
            // status. A failure here is NOT fatal — the stored key is still
            // used for requests, which will surface the real error.
            setValidationStatus('testing');
            const result = await providerRegistry.validateProvider(providerId, config.apiKey, config.baseUrl);
            if (result.valid) {
                setValidationStatus('valid');
                setValidationError(null);
                await persistConfig({ ...config, lastValidated: Date.now(), validationStatus: 'valid' });
            } else {
                setValidationStatus(result.status);
                setValidationError(result.error || 'Validation failed');
                await persistConfig({ ...config, validationStatus: result.status, validationError: result.error });
            }
        } catch (error) {
            console.error('[ProviderContext] Failed to activate provider:', error);
            setValidationStatus('error');
            setValidationError(error instanceof Error ? error.message : 'Unknown error');
        }
    }, [persistConfig]);

    // Load the selected provider on mount.
    useEffect(() => {
        if (initRef.current) return;
        initRef.current = true;

        const raw = getSetting('ai.activeProvider');
        const providerId = isProviderId(raw) ? raw : null;
        const model = getSetting('ai.defaultModel');
        if (providerId) {
            void activateProvider(providerId, typeof model === 'string' ? model : undefined);
        }
    }, [activateProvider]);

    // React to a provider/model change made elsewhere in the app.
    useEffect(() => {
        const unsubscribe = subscribeSettings(() => {
            const nextMode = getAIMode();
            if (nextMode !== mode) setModeState(nextMode);

            const raw = getSetting('ai.activeProvider');
            const providerId = isProviderId(raw) ? raw : null;
            const model = getSetting('ai.defaultModel');
            const modelId = typeof model === 'string' ? model : '';

            if (providerId !== activeProvider) {
                if (providerId) {
                    void activateProvider(providerId, modelId || undefined);
                } else {
                    setActiveProviderState(null);
                    setActiveConfigState(null);
                    setActiveModelState(null);
                    setAvailableModels([]);
                    setValidationStatus('unknown');
                    setValidationError(null);
                }
            } else if (providerId && modelId && modelId !== activeModel) {
                setActiveModelState(modelId);
                if (activeConfig) {
                    const newConfig = { ...activeConfig, model: modelId };
                    setActiveConfigState(newConfig);
                    void persistConfig(newConfig);
                }
            }
        });

        return unsubscribe;
    }, [activeProvider, activeModel, activeConfig, mode, activateProvider, persistConfig]);

    const setMode = useCallback((next: AIMode) => {
        setModeState(next);
        setAIMode(next);
    }, []);

    const setActiveProvider = useCallback(async (providerId: ProviderId | null, model?: string) => {
        if (providerId === null) {
            setActiveProviderState(null);
            setActiveConfigState(null);
            setActiveModelState(null);
            setAvailableModels([]);
            setValidationStatus('unknown');
            setValidationError(null);
            setSetting('ai.activeProvider', '');
            setSetting('ai.defaultModel', '');
            return;
        }

        // Selecting a provider does NOT change the AI mode. The mode is an
        // explicit choice; configuring a provider must not silently start
        // routing requests through it.
        setSetting('ai.activeProvider', providerId);
        if (model) setSetting('ai.defaultModel', model);
    }, []);

    const validateProvider = useCallback(async (
        providerId: ProviderId,
        apiKey: string,
        baseUrl?: string,
        rememberOnDevice = false,
    ): Promise<boolean> => {
        if (validatingProviderRef.current === providerId) return false;
        validatingProviderRef.current = providerId;
        setIsValidating(true);
        setValidationStatus('testing');
        setValidationError(null);

        try {
            const adapter = providerRegistry.get(providerId);
            if (!adapter) throw new Error(`Unknown provider: ${providerId}`);

            const selectedModel = getSetting('ai.defaultModel');
            const config: ProviderConfig = {
                id: providerId,
                name: adapter.name,
                apiKey,
                model: (typeof selectedModel === 'string' && selectedModel) || adapter.defaultModel,
                baseUrl,
                rememberOnDevice,
            };

            if (providerId === 'custom') customProvider.configure(config);

            const result = await providerRegistry.validateProvider(providerId, apiKey, baseUrl);

            if (result.valid) {
                setValidationStatus('valid');
                setValidationError(null);
                await persistConfig({
                    ...config,
                    lastValidated: Date.now(),
                    validationStatus: 'valid',
                });
                setActiveConfigState(config);
                setActiveModelState(config.model);
                if (result.models) setAvailableModels(result.models);
            } else {
                setValidationStatus(result.status);
                setValidationError(result.error || 'Validation failed');
            }

            validatingProviderRef.current = null;
            setIsValidating(false);
            return result.valid;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Validation failed';
            setValidationStatus('error');
            setValidationError(message);
            validatingProviderRef.current = null;
            setIsValidating(false);
            return false;
        }
    }, [persistConfig]);

    const fetchModels = useCallback(async (
        providerId: ProviderId,
        apiKey: string,
        baseUrl?: string,
    ): Promise<ModelInfo[]> => {
        try {
            const models = await providerRegistry.fetchModels(providerId, apiKey, baseUrl);
            setAvailableModels(models);
            return models;
        } catch (error) {
            console.error('[ProviderContext] Failed to fetch models:', error);
            return [];
        }
    }, []);

    const removeProvider = useCallback(async (providerId: ProviderId) => {
        await sessionStore.removeCredentials(providerId);
        await encryptedStore.removeCredentials(providerId);

        if (activeProvider === providerId) {
            setActiveProviderState(null);
            setActiveConfigState(null);
            setActiveModelState(null);
            setAvailableModels([]);
            setValidationStatus('unknown');
            setValidationError(null);
            setSetting('ai.activeProvider', '');
            setSetting('ai.defaultModel', '');
        }
    }, [activeProvider]);

    const updateProviderConfig = useCallback(async (config: ProviderConfig) => {
        const store = getStoreForConfig(config);
        await store.setCredentials(config);

        if (activeProvider === config.id) {
            setActiveConfigState(config);
            setActiveModelState(config.model);
        }
    }, [activeProvider]);

    const unlockVault = useCallback(async (passphrase: string): Promise<boolean> => {
        const success = await encryptedStore.unlock(passphrase);
        setIsVaultUnlocked(success);
        if (success) {
            // Re-activate so the panel reflects the unlocked credentials.
            const raw = getSetting('ai.activeProvider');
            if (isProviderId(raw)) {
                void activateProvider(raw);
            }
        }
        return success;
    }, [activateProvider]);

    const lockVault = useCallback(() => {
        encryptedStore.lock();
        setIsVaultUnlocked(false);
    }, []);

    const initializeVault = useCallback(async (passphrase: string) => {
        await encryptedStore.initializeVault(passphrase);
        setIsVaultUnlocked(true);
    }, []);

    const value = useMemo<ProviderContextType>(() => ({
        mode,
        activeProvider,
        activeConfig,
        activeModel,
        validationStatus,
        validationError,
        isValidating,
        availableModels,
        setMode,
        setActiveProvider,
        validateProvider,
        fetchModels,
        removeProvider,
        updateProviderConfig,
        unlockVault,
        lockVault,
        isVaultUnlocked,
        initializeVault,
    }), [
        mode,
        activeProvider,
        activeConfig,
        activeModel,
        validationStatus,
        validationError,
        isValidating,
        availableModels,
        isVaultUnlocked,
        setMode,
        setActiveProvider,
        validateProvider,
        fetchModels,
        removeProvider,
        updateProviderConfig,
        unlockVault,
        lockVault,
        initializeVault,
    ]);

    return (
        <ProviderContext.Provider value={value}>
            {children}
        </ProviderContext.Provider>
    );
};

/**
 * Hook to get the active provider configuration for AI requests.
 * Returns a snapshot that must not be mutated by the caller.
 */
export function useActiveProviderConfig(): ProviderConfig | null {
    const { activeConfig, activeProvider, activeModel } = useProvider();

    if (!activeProvider || !activeConfig) return null;

    return {
        ...activeConfig,
        model: activeModel || activeConfig.model,
    };
}

/**
 * Get the provider adapter for the active provider.
 */
export function useActiveProviderAdapter() {
    const { activeProvider } = useProvider();
    if (!activeProvider) return null;
    return providerRegistry.get(activeProvider) || null;
}
