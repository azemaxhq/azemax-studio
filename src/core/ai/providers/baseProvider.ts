/**
 * Base provider adapter with common functionality
 * All specific provider adapters extend this class
 */

import type {
  AIProviderAdapter,
  ProviderId,
  ProviderCapabilities,
  ProviderValidationStatus,
  ModelInfo,
  UnifiedAIRequestOptions,
  UnifiedStreamEvent,
  UnifiedAIResponse,
} from '../byokTypes';
import { AIError, AI_ERROR_CODES, classifyProviderError } from '../AIError';
import { redactDeep } from '../redaction';
import {
  assertEndpointAllowed,
  resolveRedirectTarget,
  type EndpointPolicy,
} from './endpointPolicy';

export interface BaseProviderOptions {
  id: ProviderId;
  name: string;
  defaultModel: string;
  baseUrl: string;
  models: ModelInfo[];
  capabilities: ProviderCapabilities;
}

/** Maximum number of redirects followed for a provider request. */
const MAX_REDIRECTS = 3;

export abstract class BaseProviderAdapter implements AIProviderAdapter {
  abstract readonly id: ProviderId;
  abstract readonly name: string;
  abstract readonly defaultModel: string;
  abstract readonly baseUrl: string;
  abstract readonly models: ModelInfo[];
  abstract readonly capabilities: ProviderCapabilities;

  /** API endpoint for chat completions */
  protected abstract readonly chatEndpoint: string;

  /**
   * Outbound endpoint policy. Fixed providers use the default (no loopback);
   * the custom provider relaxes it only when explicitly configured.
   */
  protected endpointPolicy: EndpointPolicy = { allowLoopback: false };

  /** HTTP headers common to all requests */
  protected getCommonHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': this.getAuthHeader(apiKey),
    };
  }

  abstract getAuthHeader(apiKey: string): string;

  abstract buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown>;

  abstract parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null;

  abstract parseResponse(response: unknown): UnifiedAIResponse;

  /**
   * Perform an outbound provider request.
   *
   * Redirects are followed manually so every hop is re-validated against the
   * endpoint policy — a URL that passed validation cannot bounce the request
   * to a blocked destination.
   */
  protected async makeRequest(
    url: string,
    options: RequestInit,
    apiKey: string
  ): Promise<Response> {
    const headers = {
      ...this.getCommonHeaders(apiKey),
      ...options.headers,
    };

    let currentUrl = url;
    let currentOptions: RequestInit = { ...options, headers };

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Enforced at the outbound boundary, not only in the UI.
      assertEndpointAllowed(currentUrl, this.endpointPolicy);

      const response = await fetch(currentUrl, {
        ...currentOptions,
        redirect: 'manual',
      });

      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect) return response;

      const location = response.headers.get('location');
      if (!location) return response;

      currentUrl = resolveRedirectTarget(currentUrl, location, this.endpointPolicy);

      // A 303 (or a 301/302 on POST) continues as a GET without a body.
      const becomesGet = response.status === 303
        || ((response.status === 301 || response.status === 302) && currentOptions.method === 'POST');
      if (becomesGet) {
        currentOptions = { ...currentOptions, method: 'GET', body: undefined };
      }
    }

    throw new AIError({
      code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
      provider: this.id,
      model: this.defaultModel,
      retryable: false,
      message: `${this.name} redirected too many times.`,
    });
  }

  /**
   * Validate credentials by making a lightweight request
   */
  async validateCredentials(
    apiKey: string,
    baseUrl?: string
  ): Promise<{
    valid: boolean;
    status: ProviderValidationStatus;
    error?: string;
    models?: ModelInfo[];
  }> {
    try {
      // Use a minimal request to validate - typically a models list or a tiny completion
      const response = await this.makeRequest(
        `${baseUrl || this.baseUrl}/models`,
        { method: 'GET' },
        apiKey
      );

      if (response.ok) {
        // Try to fetch models if supported
        let models: ModelInfo[] | undefined;
        if (this.fetchModels) {
          try {
            models = await this.fetchModels(apiKey, baseUrl);
          } catch {
            // Ignore model fetch errors during validation
          }
        }
        return { valid: true, status: 'valid', models };
      }

      if (response.status === 401 || response.status === 403) {
        return { valid: false, status: 'invalid', error: 'Invalid API key' };
      }

      if (response.status === 429) {
        return { valid: false, status: 'rate_limited', error: 'Rate limited' };
      }

      const errorText = await response.text().catch(() => '');
      return { 
        valid: false, 
        status: 'error', 
        error: `HTTP ${response.status}: ${errorText || response.statusText}` 
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { valid: false, status: 'error', error: 'Request aborted' };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        return { valid: false, status: 'error', error: 'Network error - check your connection' };
      }
      return { valid: false, status: 'error', error: message };
    }
  }

  /**
   * Fetch available models (optional override)
   */
  async fetchModels?(
    apiKey: string,
    baseUrl?: string
  ): Promise<ModelInfo[]> {
    try {
      const response = await this.makeRequest(
        `${baseUrl || this.baseUrl}/models`,
        { method: 'GET' },
        apiKey
      );
      
      if (!response.ok) return this.models;
      
      await response.json();
      // Default implementation - override in subclasses
      return this.models;
    } catch {
      return this.models;
    }
  }

  /**
   * Stream chat completion
   */
  async *streamChat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
    const url = `${baseUrl || this.baseUrl}${this.chatEndpoint}`;
    const body = this.buildRequestBody({ ...options, stream: true });

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal,
    }, apiKey);

    if (!response.ok) {
      const error = await this.handleErrorResponse(response);
      yield {
        type: 'error',
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          provider: this.id,
          status: response.status,
        },
      };
      return;
    }

    yield { type: 'start' };

    if (!response.body) {
      yield {
        type: 'error',
        error: {
          code: AI_ERROR_CODES.AI_INVALID_RESPONSE,
          message: 'Empty response body',
          retryable: false,
          provider: this.id,
        },
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const chunk = JSON.parse(payload);
            const event = this.parseStreamChunk(chunk);
            if (event) yield event;
          } catch {
            // Ignore malformed chunks
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    yield { type: 'done' };
  }

  /**
   * Non-streaming chat completion
   */
  async chat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): Promise<UnifiedAIResponse> {
    const url = `${baseUrl || this.baseUrl}${this.chatEndpoint}`;
    const body = this.buildRequestBody({ ...options, stream: false });

    const response = await this.makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal,
    }, apiKey);

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  /**
   * Handle error responses.
   *
   * The provider's error body is REDACTED before it becomes an error message:
   * several providers echo a masked form of the submitted API key in the
   * response, and that text must never reach a log line, a chat bubble, or a
   * diagnostic payload.
   */
  protected async handleErrorResponse(response: Response): Promise<AIError> {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text().catch(() => '');
    }

    const redacted = redactDeep(errorData);
    const message = typeof redacted === 'object' && redacted !== null
      ? JSON.stringify(redacted)
      : String(redacted);

    return classifyProviderError({
      provider: this.id,
      model: this.defaultModel,
      status: response.status,
      message,
    });
  }

  /**
   * Normalize provider-specific error to unified AIError
   */
  normalizeError(error: unknown, model: string): AIError {
    if (error instanceof AIError) return error;
    return classifyProviderError({
      provider: this.id,
      model,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  /**
   * Create a standardized AIError from a provider error
   */
  createAIError(error: unknown, model: string, provider: ProviderId): AIError {
    if (error instanceof AIError) return error;
    return classifyProviderError({
      provider,
      model,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}