import { describe, it, expect } from 'vitest';
import {
    normalizeProviderStreamChunk,
    normalizeAIResponse,
    createAIResponseFromStream,
    normalizeProviderStreamEvent,
} from '../src/core/ai/AIProviderNormalizer';


describe('AI Provider Normalization', () => {
    describe('normalizeProviderStreamChunk', () => {
        it('should extract visible content from NVIDIA delta', () => {
            const delta = { content: 'Hello', reasoning_content: 'thinking' };
            const result = normalizeProviderStreamChunk(delta);
            expect(result.visibleContent).toBe('Hello');
            expect(result.reasoningContent).toBe('thinking');
        });

        it('should handle reasoning-only chunk', () => {
            const delta = { content: undefined, reasoning_content: 'internal reasoning' };
            const result = normalizeProviderStreamChunk(delta);
            expect(result.visibleContent).toBeNull();
            expect(result.reasoningContent).toBe('internal reasoning');
        });

        it('should handle content-only chunk', () => {
            const delta = { content: 'Visible text', reasoning_content: undefined };
            const result = normalizeProviderStreamChunk(delta);
            expect(result.visibleContent).toBe('Visible text');
            expect(result.reasoningContent).toBeNull();
        });

        it('should handle empty chunk', () => {
            const delta = { content: '', reasoning_content: '' };
            const result = normalizeProviderStreamChunk(delta);
            // Empty content returns null (no visible content to forward)
            expect(result.visibleContent).toBeNull();
            expect(result.reasoningContent).toBeNull();
        });
    });

    describe('normalizeAIResponse', () => {
        it('should normalize NVIDIA response', () => {
            const response = {
                choices: [{
                    message: {
                        content: 'Final answer',
                        reasoning_content: 'Internal reasoning',
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 50,
                    total_tokens: 150,
                    completion_tokens_details: { reasoning_tokens: 20 },
                },
            };
            const result = normalizeAIResponse('nvidia', 'nvidia/nemotron-3-super-120b-a12b', response);
            expect(result.content).toBe('Final answer');
            expect(result.provider).toBe('nvidia');
            expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b');
            expect(result.finishReason).toBe('stop');
            expect(result.usage?.promptTokens).toBe(100);
            expect(result.usage?.completionTokens).toBe(50);
            expect(result.usage?.totalTokens).toBe(150);
        });

        it('should normalize Kilo Code response', () => {
            const response = {
                choices: [{
                    message: { content: 'Kilo answer' },
                    finish_reason: 'stop',
                }],
                usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
            };
            const result = normalizeAIResponse('kilocode', 'kilo:nemotron-3-super', response);
            expect(result.content).toBe('Kilo answer');
            expect(result.provider).toBe('kilocode');
            expect(result.model).toBe('kilo:nemotron-3-super');
        });

        it('should handle empty response', () => {
            const response = { choices: [{ message: { content: '' } }] };
            const result = normalizeAIResponse('nvidia', 'nvidia/nemotron-3-super-120b-a12b', response);
            expect(result.content).toBe('');
        });

        it('should not include reasoning_content in normalized response', () => {
            const response = {
                choices: [{
                    message: {
                        content: 'Answer',
                        reasoning_content: 'This should not appear',
                    },
                }],
            };
            const result = normalizeAIResponse('nvidia', 'nvidia/nemotron-3-super-120b-a12b', response);
            expect(result.content).toBe('Answer');
            expect(JSON.stringify(result)).not.toContain('This should not appear');
        });
    });

    describe('createAIResponseFromStream', () => {
        it('should create response from accumulated stream', () => {
            const result = createAIResponseFromStream(
                'nvidia',
                'nvidia/nemotron-3-super-120b-a12b',
                'Accumulated content',
                { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
                'stop'
            );
            expect(result.content).toBe('Accumulated content');
            expect(result.provider).toBe('nvidia');
            expect(result.model).toBe('nvidia/nemotron-3-super-120b-a12b');
            expect(result.finishReason).toBe('stop');
        });
    });

    describe('normalizeProviderStreamEvent', () => {
        it('should normalize delta event', () => {
            const event = { type: 'delta' as const, content: 'Token' };
            const result = normalizeProviderStreamEvent('nvidia', 'model', event);
            expect(result.type).toBe('delta');
            expect(result.content).toBe('Token');
        });

        it('should normalize reasoning event', () => {
            const event = { type: 'reasoning' as const, reasoning_content: 'Reasoning' };
            const result = normalizeProviderStreamEvent('nvidia', 'model', event);
            expect(result.type).toBe('reasoning');
            expect(result.content).toBe('Reasoning');
        });

        it('should normalize done event', () => {
            const event = { type: 'done' as const, usage: { total_tokens: 100 } };
            const result = normalizeProviderStreamEvent('groq', 'model', event);
            expect(result.type).toBe('done');
            expect(result.usage?.total_tokens).toBe(100);
        });

        it('should normalize error event', () => {
            const event = { type: 'error' as const, error: { message: 'Failed', code: 'RATE_LIMIT', retryable: true } };
            const result = normalizeProviderStreamEvent('openrouter', 'model', event);
            expect(result.type).toBe('error');
            expect(result.message).toBe('Failed');
            expect(result.code).toBe('RATE_LIMIT');
            expect(result.provider).toBe('openrouter');
            expect(result.retryable).toBe(true);
        });
    });

    describe('AIResponse type consistency', () => {
        it('should have consistent structure across providers', () => {
            const nvidiaResponse = normalizeAIResponse('nvidia', 'nvidia/nemotron-3-super-120b-a12b', {
                choices: [{ message: { content: 'A' }, finish_reason: 'stop' }],
            });
            const kiloResponse = normalizeAIResponse('kilocode', 'kilo:nemotron-3-super', {
                choices: [{ message: { content: 'B' }, finish_reason: 'stop' }],
            });
            const groqResponse = normalizeAIResponse('groq', 'qwen/qwen3.6-27b', {
                choices: [{ message: { content: 'C' }, finish_reason: 'stop' }],
            });

            // All should have the same structure
            [nvidiaResponse, kiloResponse, groqResponse].forEach(r => {
                expect(typeof r.content).toBe('string');
                expect(typeof r.provider).toBe('string');
                expect(typeof r.model).toBe('string');
                expect(r.finishReason).toBeDefined();
            });
        });
    });
});