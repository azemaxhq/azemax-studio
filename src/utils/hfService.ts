import OpenAI from 'openai';
import type { Settings } from '../types/settings';
import type { ChatMessage, ChatOptions } from './groqService';

// ============================================================================
// HuggingFace Inference API Service (OpenAI-compatible via router.huggingface.co)
// ============================================================================

const HF_BASE_URL = 'https://router.huggingface.co/v1';
export const HF_DEFAULT_MODEL = 'deepseek-ai/DeepSeek-R1:novita';

// Prefix used to identify HF models in the unified model list
export const HF_MODEL_PREFIX = 'hf:';

/**
 * Get an OpenAI client configured for HuggingFace Inference API
 */
export const getHFClient = () => {
    const apiKey = import.meta.env.VITE_HF_TOKEN || '';

    if (!apiKey) {
        throw new Error('HuggingFace token is required. Please set VITE_HF_TOKEN in your environment.');
    }

    return new OpenAI({
        baseURL: HF_BASE_URL,
        apiKey,
        dangerouslyAllowBrowser: true,
    });
};

/**
 * Strip the HF prefix from a model name to get the actual model ID
 */
export const stripHFPrefix = (model: string): string => {
    return model.startsWith(HF_MODEL_PREFIX) ? model.slice(HF_MODEL_PREFIX.length) : model;
};

/**
 * Check if a model is an HF model
 */
export const isHFModel = (model: string): boolean => {
    return model.startsWith(HF_MODEL_PREFIX);
};

/**
 * Available HuggingFace models
 */
export const getHFModels = (): string[] => {
    return [
        `${HF_MODEL_PREFIX}${HF_DEFAULT_MODEL}`,
    ];
};

// ============================================================================
// Clean response — handle DeepSeek <think> blocks
// ============================================================================

const cleanResponse = (content: string): string => {
    let cleaned = content;
    // Remove thinking blocks (DeepSeek-R1 uses <think>...</think>)
    cleaned = cleaned.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');

    // Remove markdown code fences if the entire response is wrapped
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
 * Send a non-streaming chat request via HuggingFace
 */
export const sendHFChatRequest = async (
    messages: ChatMessage[],
    options: ChatOptions = {},
): Promise<string> => {
    const client = getHFClient();
    const model = options.model ? stripHFPrefix(options.model) : HF_DEFAULT_MODEL;

    // Determine max tokens based on response length
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
        console.error('[HFService] Error:', error);
        throw error;
    }
};

/**
 * Stream a chat request via HuggingFace
 */
export async function* streamHFChatRequest(
    messages: ChatMessage[],
    options: ChatOptions = {},
): AsyncGenerator<string, void, unknown> {
    const client = getHFClient();
    const model = options.model ? stripHFPrefix(options.model) : HF_DEFAULT_MODEL;

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
        console.error('[HFService] Stream Error:', error);
        throw error;
    }
}

export default {
    sendHFChatRequest,
    streamHFChatRequest,
    getHFModels,
    isHFModel,
    stripHFPrefix,
};
