/**
 * Anthropic Provider Adapter
 * Supports Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage, AIToolCall } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
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
    description: 'Most capable Claude model for complex tasks',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
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
    description: 'Fast, efficient Claude model',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
    },
    description: 'Previous flagship model for complex reasoning',
  },
];

const ANTHROPIC_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: true,
  supportsReasoning: false,
  maxContextTokens: 200000,
  maxOutputTokens: 8192,
};

export class AnthropicProvider extends BaseProviderAdapter {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';
  readonly defaultModel = 'claude-3-5-sonnet-20241022';
  readonly baseUrl = 'https://api.anthropic.com/v1';
  readonly chatEndpoint = '/messages';
  readonly models = ANTHROPIC_MODELS;
  readonly capabilities = ANTHROPIC_CAPABILITIES;

  getAuthHeader(apiKey: string): string {
    return `Bearer ${apiKey}`;
  }

  buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown> {
    const { model, messages, temperature, maxTokens, topP, stream, tools, toolChoice } = options;
    
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    // Convert messages to Anthropic format
    const anthropicMessages = userMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        };
      }
      
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.tool_calls.map((tc: AIToolCall) => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        };
      }

      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      };
    });

    const body: Record<string, unknown> = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens || 4096,
      temperature: temperature ?? 0.7,
      stream: stream ?? false,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (topP !== undefined) body.top_p = topP;
    if (tools && tools.length) {
      body.tools = tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      body.tool_choice = toolChoice === 'auto' ? { type: 'auto' } : 
        toolChoice === 'required' ? { type: 'any' } : 
        { type: 'tool', name: toolChoice };
    }

    return body;
  }

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    if (!chunk || typeof chunk !== 'object') return null;
    const data = chunk as Record<string, unknown>;
    
    // Anthropic streaming events
    if (data.type === 'content_block_delta') {
      const delta = data.delta as Record<string, unknown> | undefined;
      if (!delta) return null;
      
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return { type: 'delta', content: delta.text };
      }
      
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        // Tool call argument streaming - we'll accumulate and emit at the end
        return null; // Handled in content_block_stop
      }
    }
    
    if (data.type === 'content_block_stop') {
      // Tool call completed - we'd need to track state across chunks
      // For simplicity, we rely on the final message
      return null;
    }

    if (data.type === 'message_delta') {
      const delta = data.delta as Record<string, unknown> | undefined;
      if (delta?.stop_reason) {
        return {
          type: 'done',
          finishReason: delta.stop_reason as string,
          usage: data.usage as AIUsage | undefined,
        };
      }
    }

    if (data.type === 'message_stop') {
      return { type: 'done' };
    }

    return null;
  }

  parseResponse(response: unknown): UnifiedAIResponse {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }
    const data = response as Record<string, unknown>;
    
    const contentBlocks = data.content as unknown[];
    if (!Array.isArray(contentBlocks)) {
      throw new Error('No content in response');
    }

    let content = '';
    const toolCalls: AIToolCall[] = [];

    for (const block of contentBlocks) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      
      if (b.type === 'text' && typeof b.text === 'string') {
        content += b.text;
      } else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id as string,
          type: 'function',
          function: {
            name: b.name as string,
            arguments: JSON.stringify(b.input),
          },
        });
      }
    }

    const usage = data.usage as AIUsage | undefined;
    if (usage) {
      // Anthropic uses input_tokens/output_tokens
      usage.prompt_tokens = usage.input_tokens;
      usage.completion_tokens = usage.output_tokens;
      usage.total_tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    }

    return {
      content,
      toolCalls,
      usage,
      finishReason: data.stop_reason as string | undefined,
      model: data.model as string || this.defaultModel,
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
          message: 'Invalid Anthropic API key',
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
          message: 'Anthropic rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const anthropicProvider = new AnthropicProvider();