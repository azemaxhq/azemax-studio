/**
 * Client-side per-task AI profiles — mirrors server/services/ai/taskConfig.cjs.
 *
 * Single source of truth for the client's task-aware routing metadata:
 * temperature, maxTokens, and the reasoning mode. Reasoning is OFF for
 * latency-critical / simple tasks (chat, fast_chat, explanation, comment,
 * simple_edit, autocomplete), LOW for complex code work, and HIGH only for
 * deep_reasoning. The reasoning trace is ALWAYS separated from visible content
 * at the transport layer — it is never rendered.
 */

import type { AiTaskKey } from './types';

export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

export interface ClientTaskProfile {
    temperature: number;
    top_p?: number;
    maxTokens: number;
    reasoningMode: 'off' | 'low' | 'high';
    chatTemplateKwargs?: { enable_thinking?: boolean; reasoning_effort?: 'none' | 'low' | 'high' };
}

export const AI_TASK_CONFIG: Record<AiTaskKey, ClientTaskProfile> = {
    autocomplete: {
        temperature: 0.1,
        top_p: 0.95,
        maxTokens: 512,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    comment: {
        temperature: 0.3,
        top_p: 0.95,
        maxTokens: 2048,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    simple_edit: {
        temperature: 0.1,
        top_p: 0.95,
        maxTokens: 8192,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    chat: {
        temperature: 0.7,
        top_p: 0.95,
        maxTokens: 1024,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    explanation: {
        temperature: 0.5,
        top_p: 0.95,
        maxTokens: 1024,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    complex_code: {
        temperature: 0.2,
        top_p: 0.95,
        maxTokens: 2048,
        reasoningMode: 'low',
        chatTemplateKwargs: { enable_thinking: true, reasoning_effort: 'low' },
    },
    fast_chat: {
        temperature: 1,
        top_p: 0.95,
        maxTokens: 512,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },
    deep_reasoning: {
        temperature: 0.7,
        top_p: 0.95,
        maxTokens: 4096,
        reasoningMode: 'high',
        chatTemplateKwargs: { enable_thinking: true, reasoning_effort: 'high' },
    },
};

export function getTaskConfig(task?: AiTaskKey): ClientTaskProfile {
    return (task && AI_TASK_CONFIG[task]) || AI_TASK_CONFIG.chat;
}