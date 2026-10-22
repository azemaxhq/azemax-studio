/**
 * Provider Registry
 * Central registry for all AI provider adapters
 */

import type { ProviderRegistry, AIProviderAdapter, ProviderId, ProviderConfig, ModelInfo, ProviderValidationStatus } from '../byokTypes';
import { openaiProvider } from './openaiProvider';
import { anthropicProvider } from './anthropicProvider';
import { googleProvider } from './googleProvider';
import { openrouterProvider } from './openrouterProvider';
import { groqProvider } from './groqProvider';
import { nvidiaProvider } from './nvidiaProvider';
import { customProvider } from './customProvider';

export { customProvider };

class ProviderRegistryImpl implements ProviderRegistry {
  private adapters = new Map<ProviderId, AIProviderAdapter>();

  constructor() {
    // Register all built-in providers
    this.register(openaiProvider);
    this.register(anthropicProvider);
    this.register(googleProvider);
    this.register(openrouterProvider);
    this.register(groqProvider);
    this.register(nvidiaProvider);
    this.register(customProvider);
  }

  register(adapter: AIProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: ProviderId): AIProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): AIProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  getByModel(model: string): AIProviderAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.models.some(m => m.id === model)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Get all available models across all providers
   */
  getAllModels(): ModelInfo[] {
    return this.getAll().flatMap(a => a.models);
  }

  /**
   * Get models for a specific provider
   */
  getModelsForProvider(providerId: ProviderId): ModelInfo[] {
    const adapter = this.get(providerId);
    return adapter?.models || [];
  }

  /**
   * Validate credentials for a provider
   */
  async validateProvider(
    providerId: ProviderId,
    apiKey: string,
    baseUrl?: string
  ): Promise<{ valid: boolean; status: ProviderValidationStatus; error?: string; models?: ModelInfo[] }> {
    const adapter = this.get(providerId);
    if (!adapter) {
      return { valid: false, status: 'error', error: `Unknown provider: ${providerId}` };
    }

    // For custom provider, configure it first
    if (providerId === 'custom' && baseUrl) {
      customProvider.configure({
        id: 'custom',
        name: 'Custom',
        apiKey,
        model: 'custom',
        baseUrl,
        rememberOnDevice: false,
      });
    }

    return adapter.validateCredentials(apiKey, baseUrl);
  }

  /**
   * Fetch available models from a provider
   */
  async fetchModels(providerId: ProviderId, apiKey: string, baseUrl?: string): Promise<ModelInfo[]> {
    const adapter = this.get(providerId);
    if (!adapter || !adapter.fetchModels) {
      return adapter?.models || [];
    }

    // For custom provider, configure it first
    if (providerId === 'custom' && baseUrl) {
      customProvider.configure({
        id: 'custom',
        name: 'Custom',
        apiKey,
        model: 'custom',
        baseUrl,
        rememberOnDevice: false,
      });
    }

    return adapter.fetchModels(apiKey, baseUrl);
  }

  /**
   * Get the adapter for a provider config
   */
  getAdapterForConfig(config: ProviderConfig): AIProviderAdapter | undefined {
    if (config.id === 'custom' && config.baseUrl) {
      customProvider.configure(config);
    }
    return this.get(config.id);
  }
}

export const providerRegistry = new ProviderRegistryImpl();
export default providerRegistry;