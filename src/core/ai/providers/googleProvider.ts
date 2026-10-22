/**
 * Google Gemini Provider Adapter
 * Supports Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 1.0 Pro
 */

import type { ModelInfo, ProviderCapabilities, UnifiedAIRequestOptions, UnifiedStreamEvent, UnifiedAIResponse } from '../byokTypes';
import type { AIUsage, AIToolCall } from '../types';
import { BaseProviderAdapter } from './baseProvider';
import { AIError, AI_ERROR_CODES } from '../AIError';

const GOOGLE_MODELS: ModelInfo[] = [
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
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
    description: 'Most capable Gemini model with 1M context window',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
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
    description: 'Fast, efficient Gemini model',
  },
  {
    id: 'gemini-1.0-pro',
    name: 'Gemini 1.0 Pro',
    provider: 'google',
    contextWindow: 32768,
    maxOutputTokens: 2048,
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsSystemPrompt: true,
      supportsImages: true,
      supportsReasoning: false,
      maxContextTokens: 32768,
      maxOutputTokens: 2048,
    },
    description: 'Previous generation Gemini model',
  },
];

const GOOGLE_CAPABILITIES: ProviderCapabilities = {
  supportsStreaming: true,
  supportsToolCalling: true,
  supportsSystemPrompt: true,
  supportsImages: true,
  supportsReasoning: false,
  maxContextTokens: 1048576,
  maxOutputTokens: 8192,
};

export class GoogleProvider extends BaseProviderAdapter {
  readonly id = 'google' as const;
  readonly name = 'Google Gemini';
  readonly defaultModel = 'gemini-1.5-pro';
  readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  readonly chatEndpoint = '/models/{{model}}:generateContent';
  readonly models = GOOGLE_MODELS;
  readonly capabilities = GOOGLE_CAPABILITIES;

  getAuthHeader(_apiKey: string): string {
    // The key is sent as the `x-goog-api-key` HEADER, not as a `?key=`
    // query parameter. A key in the URL would end up in browser history,
    // proxy logs and Referer headers.
    return '';
  }

  /**
   * Google authenticates with the `x-goog-api-key` header.
   *
   * Overridden so the key never appears in the request URL.
   */
  protected getCommonHeaders(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };
  }

  buildRequestBody(options: UnifiedAIRequestOptions): Record<string, unknown> {
    const { messages, temperature, maxTokens, topP, tools, toolChoice } = options;
    
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');

    // Convert messages to Gemini format
    const contents = userMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'function',
          parts: [{
            functionResponse: {
              name: m.name || '',
              response: { result: m.content },
            },
          }],
        };
      }
      
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'model',
          parts: m.tool_calls.map((tc: AIToolCall) => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          })),
        };
      }

      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      };
    });

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens || 4096,
        topP: topP ?? 0.95,
      },
    };

    if (systemMessage) {
      body.systemInstruction = { parts: [{ text: systemMessage.content }] };
    }

    if (tools && tools.length) {
      body.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
      body.toolConfig = {
        functionCallingConfig: {
          mode: toolChoice === 'auto' ? 'AUTO' : 
            toolChoice === 'required' ? 'ANY' : 
            'NONE',
        },
      };
    }

    return body;
  }

  // The key travels in the `x-goog-api-key` header (see getCommonHeaders),
  // so the base implementation's URL handling is used unchanged.

  protected getEndpoint(model: string): string {
    return `${this.baseUrl}/models/${model}:generateContent`;
  }

  async chat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): Promise<UnifiedAIResponse> {
    const url = (baseUrl || this.baseUrl).replace('{{model}}', options.model) + ':generateContent';
    const body = this.buildRequestBody(options);

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

  async *streamChat(
    options: UnifiedAIRequestOptions,
    apiKey: string,
    baseUrl?: string
  ): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
    const url = (baseUrl || this.baseUrl).replace('{{model}}', options.model) + ':streamGenerateContent?alt=sse';
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
          code: 'AI_INVALID_RESPONSE',
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
          if (!payload) continue;

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

  parseStreamChunk(chunk: unknown): UnifiedStreamEvent | null {
    if (!chunk || typeof chunk !== 'object') return null;
    const data = chunk as Record<string, unknown>;
    
    // Gemini streaming response
    const candidates = data.candidates as unknown[];
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    
    const candidate = candidates[0] as Record<string, unknown>;
    const content = candidate.content as Record<string, unknown> | undefined;
    if (!content) return null;
    
    const parts = content.parts as unknown[];
    if (!Array.isArray(parts)) return null;
    
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      
      if (typeof p.text === 'string' && p.text) {
        return { type: 'delta', content: p.text };
      }
      
      if (p.functionCall) {
        const fc = p.functionCall as Record<string, unknown>;
        return {
          type: 'tool_calls',
          toolCalls: [{
            id: `call_${Date.now()}`,
            type: 'function',
            function: {
              name: fc.name as string,
              arguments: JSON.stringify(fc.args),
            },
          }],
        };
      }
    }
    
    if (candidate.finishReason) {
      return {
        type: 'done',
        finishReason: candidate.finishReason as string,
        usage: data.usageMetadata as AIUsage | undefined,
      };
    }

    return null;
  }

  parseResponse(response: unknown): UnifiedAIResponse {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }
    const data = response as Record<string, unknown>;
    
    const candidates = data.candidates as unknown[];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error('No candidates in response');
    }

    const candidate = candidates[0] as Record<string, unknown>;
    const content = candidate.content as Record<string, unknown> | undefined;
    if (!content) {
      throw new Error('No content in response');
    }

    const parts = content.parts as unknown[];
    if (!Array.isArray(parts)) {
      throw new Error('No parts in response');
    }

    let textContent = '';
    const toolCalls: AIToolCall[] = [];

    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      
      if (typeof p.text === 'string') {
        textContent += p.text;
      } else if (p.functionCall) {
        const fc = p.functionCall as Record<string, unknown>;
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: 'function',
          function: {
            name: fc.name as string,
            arguments: JSON.stringify(fc.args),
          },
        });
      }
    }

    const usageMetadata = data.usageMetadata as Record<string, unknown> | undefined;
    let usage: AIUsage | undefined;
    if (usageMetadata) {
      usage = {
        prompt_tokens: usageMetadata.promptTokenCount as number,
        completion_tokens: usageMetadata.candidatesTokenCount as number,
        total_tokens: usageMetadata.totalTokenCount as number,
      };
    }

    return {
      content: textContent,
      toolCalls,
      usage,
      finishReason: candidate.finishReason as string | undefined,
      model: data.modelVersion as string || this.defaultModel,
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
          message: 'Invalid Google API key',
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
          message: 'Google rate limit exceeded',
          cause: error,
        });
      }
    }
    return super.normalizeError(error, model);
  }
}

export const googleProvider = new GoogleProvider();