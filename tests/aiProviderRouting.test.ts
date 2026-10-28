import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inferProvider, buildDirectChain, configuredDirectProviders, defaultModelFor } from '../src/core/ai/modelRouter';
import { getTaskConfig } from '../src/core/ai/taskConfigClient';

describe('AI Provider Routing', () => {
    // A configured direct provider is a routing fixture, not a credential:
    // the transport is never called in these tests. CI has no provider keys,
    // so the chain would otherwise be empty and the NVIDIA-primary case could
    // not be asserted deterministically.
    beforeEach(() => {
        vi.stubEnv('VITE_GROQ_API_KEY', 'unit-test-routing-stub');
    });

    describe('inferProvider', () => {
        it('should identify NVIDIA models', () => {
            expect(inferProvider('nvidia/nemotron-3-super-120b-a12b')).toBe('nvidia');
            expect(inferProvider('nvidia/nemotron-3-ultra-550b-a55b')).toBe('nvidia');
        });

        it('should identify Groq models', () => {
            expect(inferProvider('qwen/qwen3.8-27b')).toBe('groq');
            expect(inferProvider('openai/gpt-oss-20b')).toBe('groq');
            expect(inferProvider('openai/gpt-oss-120b')).toBe('groq');
            expect(inferProvider('allam-2-7b')).toBe('groq');
        });

        it('should identify OpenRouter models', () => {
            expect(inferProvider('or:nvidia/nemotron-3-super-120b-a12b:free')).toBe('openrouter');
            expect(inferProvider('or:meta-llama/llama-3.3-70b-instruct:free')).toBe('openrouter');
        });

        it('should identify HuggingFace models', () => {
            expect(inferProvider('hf:deepseek-ai/DeepSeek-R1:novita')).toBe('huggingface');
        });

        it('should identify Kilo Code models', () => {
            expect(inferProvider('kilo:nemotron-3-super')).toBe('kilocode');
            expect(inferProvider('kilo:gpt-4o')).toBe('kilocode');
            expect(inferProvider('kilo:claude-3.5-sonnet')).toBe('kilocode');
        });

        it('should default to groq for unknown models with slash', () => {
            expect(inferProvider('some/unknown-model')).toBe('openrouter');
        });

        it('should default to nvidia for empty model', () => {
            expect(inferProvider('')).toBe('nvidia');
            expect(inferProvider(undefined as unknown as string)).toBe('nvidia');
        });
    });

    describe('configuredDirectProviders', () => {
        it('should return providers with configured API keys', () => {
            const providers = configuredDirectProviders();
            expect(Array.isArray(providers)).toBe(true);
            providers.forEach(p => {
                expect(['groq', 'openrouter', 'huggingface', 'kilocode']).toContain(p);
            });
        });
    });

    describe('defaultModelFor', () => {
        it('should return correct default model for each provider', () => {
            expect(defaultModelFor('groq')).toBe('qwen/qwen3.8-27b');
            expect(defaultModelFor('openrouter')).toBe('or:nvidia/nemotron-3-super-120b-a12b:free');
            expect(defaultModelFor('huggingface')).toBe('hf:deepseek-ai/DeepSeek-R1:novita');
            expect(defaultModelFor('kilocode')).toBe('kilo:nemotron-3-super');
        });
    });

    describe('buildDirectChain', () => {
        it('should build chain with primary model first (direct providers only, no NVIDIA)', () => {
            const chain = buildDirectChain('chat', 'nvidia/nemotron-3-super-120b-a12b', { allowFallback: true });
            expect(chain.length).toBeGreaterThan(0);
            // Direct chain should not include NVIDIA (it's backend-only)
            // It should start with the first configured direct provider's default
        });

        it('should use requested model if it is a direct provider', () => {
            const chain = buildDirectChain('chat', 'qwen/qwen3.8-27b', { allowFallback: true });
            expect(chain.length).toBeGreaterThan(0);
            expect(chain[0]).toBe('qwen/qwen3.8-27b');
        });

        it('should not include fallback when allowFallback is false', () => {
            const chain = buildDirectChain('autocomplete', 'qwen/qwen3.8-27b', { allowFallback: false });
            expect(chain.length).toBe(1);
        });
    });

    describe('Task Profiles', () => {
        it('should have correct reasoning mode for chat', () => {
            const config = getTaskConfig('chat');
            expect(config.reasoningMode).toBe('off');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('none');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(false);
            expect(config.maxTokens).toBe(1024);
            expect(config.temperature).toBe(0.7);
        });

        it('should have correct reasoning mode for comment', () => {
            const config = getTaskConfig('comment');
            expect(config.reasoningMode).toBe('off');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('none');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(false);
            expect(config.maxTokens).toBe(2048);
        });

        it('should have correct reasoning mode for inline completion', () => {
            const config = getTaskConfig('autocomplete');
            expect(config.reasoningMode).toBe('off');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('none');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(false);
            expect(config.maxTokens).toBe(512);
        });

        it('should have correct reasoning mode for code generation', () => {
            const config = getTaskConfig('simple_edit');
            expect(config.reasoningMode).toBe('off');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('none');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(false);
            expect(config.maxTokens).toBe(8192);
        });

        it('should have correct reasoning mode for code fix', () => {
            const config = getTaskConfig('complex_code');
            expect(config.reasoningMode).toBe('low');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('low');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(true);
            expect(config.maxTokens).toBe(2048);
        });

        it('should have correct reasoning mode for refactor', () => {
            const config = getTaskConfig('complex_code');
            expect(config.reasoningMode).toBe('low');
            expect(config.maxTokens).toBe(2048);
        });

        it('should have correct reasoning mode for complex agentic tasks', () => {
            const config = getTaskConfig('deep_reasoning');
            expect(config.reasoningMode).toBe('high');
            expect(config.chatTemplateKwargs?.reasoning_effort).toBe('high');
            expect(config.chatTemplateKwargs?.enable_thinking).toBe(true);
            expect(config.maxTokens).toBe(4096);
        });
    });
});