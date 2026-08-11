import OpenAI from 'openai';
import type { ChatMessage, ChatOptions } from './groqService';

// ============================================================================
// OpenRouter API Service (OpenAI-compatible)
// ============================================================================

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Prefix used to identify OpenRouter models in the unified model list
export const OR_MODEL_PREFIX = 'or:';

/**
 * Get an OpenAI client configured for OpenRouter
 */
export const getOpenRouterClient = () => {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';

    if (!apiKey) {
        throw new Error('OpenRouter API key is required. Please set VITE_OPENROUTER_API_KEY in your environment.');
    }

    return new OpenAI({
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
            'HTTP-Referer': window.location.origin,
            'X-Title': 'AI Code Editor',
        },
    });
};

/**
 * Strip the OpenRouter prefix from a model name
 */
export const stripORPrefix = (model: string): string => {
    return model.startsWith(OR_MODEL_PREFIX) ? model.slice(OR_MODEL_PREFIX.length) : model;
};

/**
 * Check if a model is an OpenRouter model
 */
export const isORModel = (model: string): boolean => {
    return model.startsWith(OR_MODEL_PREFIX);
};

/**
 * Available free OpenRouter models
 */
export const getORModels = (): string[] => {
    return [
        `${OR_MODEL_PREFIX}openrouter/free`,
        `${OR_MODEL_PREFIX}qwen/qwen3-coder:free`,
        `${OR_MODEL_PREFIX}meta-llama/llama-3.3-70b-instruct:free`,
        `${OR_MODEL_PREFIX}deepseek/deepseek-v4-flash:free`,
        `${OR_MODEL_PREFIX}google/gemma-4-31b-it:free`,
        `${OR_MODEL_PREFIX}minimax/minimax-m2.5:free`,
    ];
};

// ============================================================================
// Response Cleaning
// ============================================================================

const cleanResponse = (content: string): string => {
    let cleaned = content;
    // Remove thinking blocks
    cleaned = cleaned.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');

    // Remove markdown code fences if wrapped
    const codeBlockMatch = cleaned.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[2];
    } else {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim() || content.trim();
};

// ============================================================================
// Service Methods
// ============================================================================

/**
 * Send a non-streaming chat request via OpenRouter
 */
export const sendORChatRequest = async (
    messages: ChatMessage[],
    options: ChatOptions = {},
): Promise<string> => {
    const client = getOpenRouterClient();
    const model = options.model ? stripORPrefix(options.model) : 'openrouter/free';

    const getMaxTokens = (length: 'short' | 'medium' | 'long') => {
        switch (length) {
            case 'short': return 500;
            case 'medium': return 1500;
            case 'long': return 3000;
            default: return 1500;
        }
    };

    try {
        const completion = await client.chat.completions.create({
            messages: messages as any,
            model,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens || getMaxTokens('medium'),
            stream: false,
        }, { signal: options.signal });

        const content = completion.choices[0]?.message?.content || '';
        return cleanResponse(content);
    } catch (error: any) {
        console.error('[OpenRouterService] Error:', error);
        throw error;
    }
};

/**
 * Stream a chat request via OpenRouter
 */
export async function* streamORChatRequest(
    messages: ChatMessage[],
    options: ChatOptions = {},
): AsyncGenerator<string, void, unknown> {
    const client = getOpenRouterClient();
    const model = options.model ? stripORPrefix(options.model) : 'openrouter/free';

    const getMaxTokens = (length: 'short' | 'medium' | 'long') => {
        switch (length) {
            case 'short': return 500;
            case 'medium': return 1500;
            case 'long': return 3000;
            default: return 1500;
        }
    };

    try {
        const stream = await client.chat.completions.create({
            messages: messages as any,
            model,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens || getMaxTokens('medium'),
            stream: true,
        }, { signal: options.signal });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
    } catch (error: any) {
        console.error('[OpenRouterService] Stream Error:', error);
        throw error;
    }
}

export default {
    sendORChatRequest,
    streamORChatRequest,
    getORModels,
    isORModel,
    stripORPrefix,
};
