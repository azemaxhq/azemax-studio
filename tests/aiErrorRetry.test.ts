import { describe, it, expect } from 'vitest';
import { AIError, AI_ERROR_CODES, classifyProviderError, allProvidersFailed } from '../src/core/ai/AIError';

describe('AIError retry classification', () => {
    it('classifies 503 as retryable', () => {
        const err = classifyProviderError({
            provider: 'test',
            model: 'test',
            status: 503,
            message: 'Service unavailable',
        });
        expect(err.code).toBe('AI_PROVIDER_UNAVAILABLE');
        expect(err.retryable).toBe(true);
    });

    it('classifies 429 as retryable', () => {
        const err = classifyProviderError({
            provider: 'test',
            model: 'test',
            status: 429,
            message: 'Rate limited',
        });
        expect(err.code).toBe('AI_PROVIDER_RATE_LIMITED');
        expect(err.retryable).toBe(true);
    });

    it('classifies 401 as non-retryable', () => {
        const err = classifyProviderError({
            provider: 'test',
            model: 'test',
            status: 401,
            message: 'Unauthorized',
        });
        expect(err.code).toBe('AI_PROVIDER_AUTH_ERROR');
        expect(err.retryable).toBe(false);
    });

    it('allProvidersFailed is retryable if any attempt was retryable', () => {
        const err = allProvidersFailed([
            { provider: 'a', model: 'm', retryable: false },
            { provider: 'b', model: 'm', retryable: true },
        ]);
        expect(err.retryable).toBe(true);
    });

    it('allProvidersFailed is not retryable if all attempts failed permanently', () => {
        const err = allProvidersFailed([
            { provider: 'a', model: 'm', retryable: false },
            { provider: 'b', model: 'm', retryable: false },
        ]);
        expect(err.retryable).toBe(false);
    });
});
