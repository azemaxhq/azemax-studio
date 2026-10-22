/**
 * NVIDIA NIM Provider Adapter
 * Supports Nemotron and other NVIDIA models
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';
import { normalizeToolCalls } from '../toolCallNormalization';

const NVIDIA_MODELS: ModelInfo[] = [
  {
    id: 'nvidia/nemotron-3-ultra',
    name: 'Nemotron 3 Ultra',
    provider: 'nvidia',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    description: 'NVIDIA Nemotron 3 Ultra - flagship model',
  },
  {
    id: 'nvidia/nemotron-3-super',
    name: 'Nemotron 3 Super',
    provider: 'nvidia',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: false,
      supportsReasoning: true,
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
    },
    description: 'NVIDIA Nemotron 3 Super - balanced performance',
  },
  {
    id: 'meta/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    provider: 'nvidia',
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
    description: 'Meta Llama 3.1 405B via NVIDIA NIM',
  },
];

const NVIDIA_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: false,
  supportsReasoning: true,
  maxContextTokens: 128000,
  maxOutputTokens: 4096,
};

export class NvidiaProvider extends BaseProviderAdapter {
  readonly id = 'nvidia' as const;
  readonly name = 'NVIDIA NIM';
  readonly defaultModel = 'nvidia/nemotron-3-ultra';
  readonly baseUrl = 'https://integrate.api.nvidia.com/v1';
  readonly chatEndpoint = '/chat/completions';
  readonly models = NVIDIA_MODELS;
  readonly capabilities = NVIDIA_CAPABILITIES;

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

    // NVIDIA supports chat_template_kwargs for reasoning
    if (this.capabilities.supportsReasoning) {
      body.chat_template_kwargs = {
        enable_thinking: true,
        reasoning_effort: 'high',
      };
    }

    return body;
  }

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    // NVIDIA uses OpenAI-compatible streaming format
    if (!chunk || typeof chunk !== 'object') return null;
    const data = chunk as Record<string, unknown>;
    
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    if (!choice) return null;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    if (typeof delta.content === 'string' && delta.content) {
      return { type: 'delta', content: delta.content };
    }

    // Handle reasoning content
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      // Reasoning is kept separate, not emitted as visible content
      // Could emit as 'reasoning' event type if needed
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
          message: 'Invalid NVIDIA API key',
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
          message: 'NVIDIA rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const nvidiaProvider = new NvidiaProvider();