/**
 * Custom OpenAI-Compatible Provider Adapter
 * Allows users to configure their own OpenAI-compatible endpoints
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse, ProviderConfig } from '../byokTypes';
import type { AIUsage } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';
import { normalizeToolCalls } from '../toolCallNormalization';
import {
  evaluateEndpoint,
  EndpointPolicyError,
  DEFAULT_ENDPOINT_POLICY,
  type EndpointPolicy,
} from './endpointPolicy';

const CUSTOM_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: false,
  supportsReasoning: false,
  maxContextTokens: 128000,
  maxOutputTokens: 4096,
};

// Default model info for custom providers (user-configured)
const CUSTOM_MODELS: ModelInfo[] = [
  {
    id: 'custom',
    name: 'Custom Model',
    provider: 'custom',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: CUSTOM_CAPABILITIES,
    description: 'User-configured OpenAI-compatible model',
  },
];

export class CustomProvider extends BaseProviderAdapter {
  readonly id = 'custom' as const;
  readonly name = 'Custom OpenAI-Compatible';
  readonly defaultModel = 'custom';
  readonly baseUrl = ''; // Set per-configuration
  readonly chatEndpoint = '/chat/completions';
  readonly models = CUSTOM_MODELS;
  readonly capabilities = CUSTOM_CAPABILITIES;

  // Store the user-configured base URL
  private customBaseUrl: string = '';
  private customModel: string = 'custom';

  getAuthHeader(apiKey: string): string {
    return `Bearer ${apiKey}`;
  }

  /**
   * Configure the provider with user settings.
   *
   * The base URL is validated here as well as in the UI: the request path
   * re-checks it at the outbound boundary, so a URL that was edited after
   * validation still cannot reach a blocked destination.
   */
  configure(config: ProviderConfig): void {
    this.customBaseUrl = config.baseUrl || '';
    this.customModel = config.model || 'custom';
    if (this.customBaseUrl) {
      const decision = evaluateEndpoint(this.customBaseUrl, this.endpointPolicy);
      if (!decision.ok) {
        throw new EndpointPolicyError(decision.reason ?? 'blocked_host', decision.message ?? 'Endpoint is not allowed.');
      }
      this.customBaseUrl = decision.url ?? this.customBaseUrl;
    }
  }

  buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown> {
    const { model, messages, temperature, maxTokens, topP, stream, tools, toolChoice, responseFormat } = options;
    
    const body: Record<string, unknown> = {
      model: model || this.customModel,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      temperature: temperature ?? 0.7,
      stream: stream ?? false,
    };

    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (topP !== undefined) body.top_p = topP;
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = toolChoice || 'auto';
    }
    if (responseFormat) body.response_format = responseFormat;

    return body;
  }

  // Override to use the custom base URL. The base implementation performs
  // the endpoint policy check and the manual, re-validated redirect follow.
  protected async makeRequest(
    url: string,
    options: RequestInit,
    apiKey: string
  ): Promise<Response> {
    const targetUrl = this.customBaseUrl ? `${this.customBaseUrl}${this.chatEndpoint}` : url;
    return super.makeRequest(targetUrl, options, apiKey);
  }

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    // Custom providers use OpenAI-compatible streaming format
    if (!chunk || typeof chunk !== 'object') return null;
    const data = chunk as Record<string, unknown>;
    
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    if (!choice) return null;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    if (typeof delta.content === 'string' && delta.content) {
      return { type: 'delta', content: delta.content };
    }

    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      const toolCalls = normalizeToolCalls(delta.tool_calls);
      if (toolCalls.length > 0) {
        return { type: 'tool_calls', toolCalls };
      }
    }

    if (choice.finish_reason) {
      const usage = data.usage as AIUsage | undefined;
      return {
        type: 'done',
        finishReason: choice.finish_reason as string,
        usage,
      };
    }

    return null;
  }

  parseResponse(response: unknown): UnifiedAIResponse {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }
    const data = response as Record<string, unknown>;
    
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    if (!choice) {
      throw new Error('No choices in response');
    }

    const message = choice.message as Record<string, unknown> | undefined;
    if (!message) {
      throw new Error('No message in response');
    }

    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = Array.isArray(message.tool_calls) 
      ? normalizeToolCalls(message.tool_calls) 
      : [];
    const usage = data.usage as AIUsage | undefined;
    const finishReason = choice.finish_reason as string | undefined;
    const model = typeof data.model === 'string' ? data.model : this.customModel;

    return {
      content,
      toolCalls,
      usage,
      finishReason,
      model,
      provider: this.id,
    };
  }

  normalizeError(error: unknown, model: string): AIError {
    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        return new AIError({
          code: AI_ERROR_CODES.AI_PROVIDER_AUTH_ERROR,
          provider: this.id,
          model,
          status,
          retryable: false,
          message: 'Invalid API key for custom endpoint',
          cause: error,
        });
      }
      if (status === 429) {
        return new AIError({
          code: AI_ERROR_CODES.AI_PROVIDER_RATE_LIMITED,
          provider: this.id,
          model,
          status,
          retryable: true,
          message: 'Custom endpoint rate limit exceeded',
          cause: error,
        });
      }
      if (status !== undefined && (status === 0 || status >= 500)) {
        return new AIError({
          code: AI_ERROR_CODES.AI_PROVIDER_SERVER_ERROR,
          provider: this.id,
          model,
          status,
          retryable: true,
          message: 'Custom endpoint unavailable - check URL and connectivity',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }

  /**
   * Validate a custom endpoint URL against the outbound endpoint policy.
   *
   * Thin delegate to the shared policy module so the UI and the request path
   * can never disagree about what is allowed.
   */
  static validateEndpoint(
    url: string,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
  ): { valid: boolean; error?: string } {
    const decision = evaluateEndpoint(url, policy);
    return decision.ok ? { valid: true } : { valid: false, error: decision.message };
  }
}

export const customProvider = new CustomProvider();