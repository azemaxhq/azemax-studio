import React from 'react';
import { AIResponseStatus } from './AIResponseStatus';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';

interface AILoadingIndicatorProps {
    status: AILoadingStatus;
    operation?: AIOperationType | string | null;
    className?: string;
    size?: 'sm' | 'md';
    showStatusText?: boolean;
    variant?: 'chat' | 'compact';
}

/**
 * Azemax AI-native loading — subtle mark + status, stable space, 180ms entrance.
 * No spinner, no glow, no layout jump. Respects prefers-reduced-motion.
 */
export const AILoadingIndicator: React.FC<AILoadingIndicatorProps> = ({
    status,
    operation,
    className = '',
    showStatusText = true,
}) => {
    if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;
    const isActive = status === 'thinking' || status === 'preparing' || status === 'generating' || status === 'streaming' || status === 'applying';
    if (!isActive) return null;

    return (
        <div className={`ai-loading-minimal ai-loading-stable ${className}`} role="status" aria-live="polite" aria-busy="true">
            {showStatusText && (
                <span className="ai-loading-minimal-text">
                    <AIResponseStatus status={status} operation={operation} />
                </span>
            )}
            <span className="ai-loading-dots-subtle ai-dots-fixed" aria-hidden="true">
                <span className="ai-dot-subtle" />
                <span className="ai-dot-subtle" />
                <span className="ai-dot-subtle" />
            </span>
        </div>
    );
};
