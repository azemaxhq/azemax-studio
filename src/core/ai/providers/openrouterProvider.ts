/**
 * OpenRouter Provider Adapter
 * Unified interface for multiple models through OpenRouter
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';
import { normalizeToolCalls } from '../toolCallNormalization';

const OPENROUTER_MODELS: ModelInfo[] = [
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super (Free)',
    provider: 'openrouter',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    description: 'NVIDIA Nemotron 3 Super via OpenRouter (free tier)',
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'Nemotron 3.5 Lightning (Free)',
    provider: 'openrouter',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    description: 'NVIDIA Nemotron 3.5 Lightning via OpenRouter (free tier)',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'openrouter',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
    },
    description: 'Anthropic Claude 3.5 Sonnet via OpenRouter',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
    },
    description: 'OpenAI GPT-4o via OpenRouter',
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini 1.5 Pro',
    provider: 'openrouter',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 1048576,
      maxOutputTokens: 8192,
    },
    description: 'Google Gemini 1.5 Pro via OpenRouter',
  },
];

const OPENROUTER_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: true,
  supportsReasoning: false,
  maxContextTokens: 1048576,
  maxOutputTokens: 16384,
};

export class OpenRouterProvider extends BaseProviderAdapter {
  readonly id = 'openrouter' as const;
  readonly name = 'OpenRouter';
  readonly defaultModel = 'nvidia/nemotron-3-super-120b-a12b:free';
  readonly baseUrl = 'https://openrouter.ai/api/v1';
  readonly chatEndpoint = '/chat/completions';
  readonly models = OPENROUTER_MODELS;
  readonly capabilities = OPENROUTER_CAPABILITIES;

  getAuthHeader(apiKey: string): string {
    return `Bearer ${apiKey}`;
  }

  buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown> {
    const { model, messages, temperature, maxTokens, topP, stream, tools, toolChoice, responseFormat } = options;
    
    const body: Record<string, unknown> = {
      model,
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

    // OpenRouter specific headers are added in makeRequest
    return body;
  }

  // Override makeRequest to add OpenRouter-specific headers
  async makeRequest(
    url: string,
    options: RequestInit,
    apiKey: string
  ): Promise<Response> {
    const headers = {
      ...this.getCommonHeaders(apiKey),
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      'X-Title': 'Azemax',
      ...options.headers,
    };

    return fetch(url, {
      ...options,
      headers,
    });
  }

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    // OpenRouter uses OpenAI-compatible streaming format
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
    const model = typeof data.model === 'string' ? data.model : this.defaultModel;

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
          message: 'Invalid OpenRouter API key',
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
          message: 'OpenRouter rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const openrouterProvider = new OpenRouterProvider();