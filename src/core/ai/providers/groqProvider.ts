/**
 * Groq Provider Adapter
 * Fast inference for Llama, Mixtral, Gemma models
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';
import { normalizeToolCalls } from '../toolCallNormalization';

const GROQ_MODELS: ModelInfo[] = [
  {
    id: 'llama-3.1-70b-versatile',
    name: 'Llama 3.1 70B Versatile',
    provider: 'groq',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 131072,
      maxOutputTokens: 8192,
    },
    description: 'Meta Llama 3.1 70B - versatile and capable',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'groq',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 131072,
      maxOutputTokens: 8192,
    },
    description: 'Fast, efficient Llama 3.1 8B model',
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'groq',
    contextWindow: 32768,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 32768,
      maxOutputTokens: 8192,
    },
    description: 'Mistral Mixtral 8x7B MoE model',
  },
  {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B',
    provider: 'groq',
    contextWindow: 8192,
    maxOutputTokens: 8192,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: false,
      maxContextTokens: 8192,
      maxOutputTokens: 8192,
    },
    description: 'Google Gemma 2 9B instruction-tuned',
  },
];

const GROQ_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: false,
  supportsReasoning: false,
  maxContextTokens: 131072,
  maxOutputTokens: 8192,
};

export class GroqProvider extends BaseProviderAdapter {
  readonly id = 'groq' as const;
  readonly name = 'Groq';
  readonly defaultModel = 'llama-3.1-70b-versatile';
  readonly baseUrl = 'https://api.groq.com/openai/v1';
  readonly chatEndpoint = '/chat/completions';
  readonly models = GROQ_MODELS;
  readonly capabilities = GROQ_CAPABILITIES;

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
    // Groq uses OpenAI-compatible streaming format
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
          message: 'Invalid Groq API key',
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
          message: 'Groq rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const groqProvider = new GroqProvider();