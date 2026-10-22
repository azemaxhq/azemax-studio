/**
 * OpenAI Provider Adapter
 * Supports GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';
import { normalizeToolCalls } from '../toolCallNormalization';

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
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
    description: 'Most capable GPT-4 model, optimized for chat and code',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
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
    description: 'Faster, cheaper GPT-4o variant',
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    description: 'Previous generation GPT-4 with larger context',
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 16385,
      maxOutputTokens: 4096,
    },
    description: 'Fast, cost-effective model for simpler tasks',
  },
];

const OPENAI_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: true,
  supportsReasoning: false,
  maxContextTokens: 128000,
  maxOutputTokens: 16384,
};

export class OpenAIProvider extends BaseProviderAdapter {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';
  readonly defaultModel = 'gpt-4o';
  readonly baseUrl = 'https://api.openai.com/v1';
  readonly chatEndpoint = '/chat/completions';
  readonly models = OPENAI_MODELS;
  readonly capabilities = OPENAI_CAPABILITIES;

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

    return body;
  }

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    if (!chunk || typeof chunk !== 'object') return null;
    const data = chunk as Record<string, unknown>;
    
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    if (!choice) return null;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    // Content delta
    if (typeof delta.content === 'string' && delta.content) {
      return { type: 'delta', content: delta.content };
    }

    // Tool calls
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      const toolCalls = normalizeToolCalls(delta.tool_calls);
      if (toolCalls.length > 0) {
        return { type: 'tool_calls', toolCalls };
      }
    }

    // Finish reason
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
          message: 'Invalid OpenAI API key',
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
          message: 'OpenAI rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const openaiProvider = new OpenAIProvider();