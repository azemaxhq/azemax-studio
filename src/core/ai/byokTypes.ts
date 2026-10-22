/**
 * BYOK (Bring Your Own Key) Provider Architecture
 * 
 * Defines the unified interface for AI providers and credential management.
 * This allows users to configure their own API keys for various providers
 * while maintaining a consistent internal contract.
 */

// Core AI types are imported for use in this module and re-exported so
// provider adapters can import every BYOK type from one place.
import type { AIToolCall, AIToolDefinition, AIToolChoice, ChatMessage, AIUsage } from './types';
import type { AIError, AIErrorCode } from './AIError';

export type { AIToolCall, AIToolDefinition, AIToolChoice, ChatMessage, AIUsage };
export type { AIError, AIErrorCode };

/** Supported AI providers */
export type ProviderId = 
  | 'openai' 
  | 'anthropic' 
  | 'google' 
  | 'openrouter' 
  | 'groq' 
  | 'nvidia' 
  | 'custom';

/** Provider configuration stored in settings */
export interface ProviderConfig {
  id: ProviderId;
  name: string;
  apiKey: string;
  model: string;
  baseUrl?: string; // Only for custom provider
  rememberOnDevice: boolean;
  lastValidated?: number;
  validationStatus?: ProviderValidationStatus;
  validationError?: string;
}

/**
 * A fully-resolved BYOK request target.
 *
 * This is a SNAPSHOT: `providerId`, `model` and `apiKey` are fixed for the
 * lifetime of the request (and of an agent task), so a concurrent settings
 * change cannot switch providers underneath a running task.
 */
export interface ResolvedByokTarget {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  config: ProviderConfig;
}

/** Validation status for a provider */
export type ProviderValidationStatus = 
  | 'unknown' 
  | 'testing' 
  | 'valid' 
  | 'invalid' 
  | 'rate_limited' 
  | 'error' 
  | 'unconfigured';

/** Provider capability flags */
export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsSystemPrompt: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

/** Model metadata */
export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  maxOutputTokens: number;
  description?: string;
}

/** Normalized request options for any provider */
export interface UnifiedAIRequestOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: AIToolDefinition[];
  toolChoice?: AIToolChoice;
  signal?: AbortSignal;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
}

/** Normalized streaming response event */
export interface UnifiedStreamEvent {
  type: 'delta' | 'tool_calls' | 'done' | 'error' | 'start';
  content?: string;
  toolCalls?: AIToolCall[];
  usage?: AIUsage;
  finishReason?: string;
  /** Model the response came from (when the provider reports it). */
  model?: string;
  error?: {
    code: AIErrorCode;
    message: string;
    retryable: boolean;
    provider?: string;
    status?: number;
  };
}

/** Non-streaming response */
export interface UnifiedAIResponse {
  content: string;
  toolCalls: AIToolCall[];
  usage?: AIUsage;
  finishReason?: string;
  model: string;
  provider: ProviderId;
}

/** Provider adapter interface - all providers must implement this */
export interface AIProviderAdapter {
  /** Provider identifier */
  readonly id: ProviderId;
  /** Human-readable name */
  readonly name: string;
  /** Default model for this provider */
  readonly defaultModel: string;
  /** Base URL for API requests */
  readonly baseUrl: string;
  /** Supported models */
  readonly models: ModelInfo[];
  /** Capability flags */
  readonly capabilities: ProviderCapabilities;

  /**
   * Validate the API key by making a lightweight request
   * Returns validation status and optional error details
   */
  validateCredentials(apiKey: string, baseUrl?: string): Promise<{
    valid: boolean;
    status: ProviderValidationStatus;
    error?: string;
    models?: ModelInfo[];
  }>;

  /**
   * Fetch available models from the provider (if supported)
   */
  fetchModels?(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;

  /**
   * Send a chat completion request (streaming)
   */
  streamChat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): AsyncGenerator<UnifiedStreamEvent, void, unknown>;

  /**
   * Send a chat completion request (non-streaming)
   */
  chat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): Promise<UnifiedAIResponse>;

  /**
   * Normalize provider-specific error to unified AIError
   */
  normalizeError(error: unknown, model: string): AIError;

  /**
   * Create a standardized AIError from a provider error (optional, default in base class)
   */
  createAIError?(error: unknown, model: string, provider: ProviderId): AIError;

  /**
   * Get the Authorization header value for this provider
   */
  getAuthHeader(apiKey: string): string;

  /**
   * Build the request body for this provider
   */
  buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown>;

  /**
   * Parse a streaming response chunk into unified events
   */
  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null;

  /**
   * Parse a non-streaming response into unified format
   */
  parseResponse(response: unknown): UnifiedAIResponse;
}

/** Registry for provider adapters */
export interface ProviderRegistry {
  register(adapter: AIProviderAdapter): void;
  get(id: ProviderId): AIProviderAdapter | undefined;
  getAll(): AIProviderAdapter[];
  getByModel(model: string): AIProviderAdapter | undefined;
}

/** Credential store interface */
export interface CredentialStore {
  /** Get credentials for a provider (session-only by default) */
  getCredentials(providerId: ProviderId): Promise<ProviderConfig | null>;
  
  /** Store credentials for a provider */
  setCredentials(config: ProviderConfig): Promise<void>;
  
  /** Remove credentials for a provider */
  removeCredentials(providerId: ProviderId): Promise<void>;
  
  /** Get all stored credentials */
  getAllCredentials(): Promise<ProviderConfig[]>;
  
  /** Clear all credentials */
  clear(): Promise<void>;
}

/** Active provider state */
export interface ActiveProviderState {
  providerId: ProviderId | null;
  config: ProviderConfig | null;
  model: string | null;
}

/** Provider selection event */
export interface ProviderSelectionEvent {
  providerId: ProviderId | null;
  model: string | null;
  previousProviderId: ProviderId | null;
}