import React from 'react';
import { AIThinkingAnimation } from './AIThinkingAnimation';
import { AIResponseStatus } from './AIResponseStatus';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';

type ThinkingStatus = 'thinking' | 'preparing' | 'generating' | 'streaming' | 'applying';

interface AILoadingIndicatorProps {
    status: AILoadingStatus;
    operation?: AIOperationType | string | null;
    className?: string;
    size?: 'sm' | 'md';
    showStatusText?: boolean;
    variant?: 'chat' | 'compact';
}

/**
 * Premium single-loader — orb + status text, no duplicate dots.
 * One visual, 60fps, no layout shift.
 */
export const AILoadingIndicator: React.FC<AILoadingIndicatorProps> = ({
    status,
    operation,
    className = '',
    size = 'md',
    showStatusText = true,
    variant = 'chat',
}) => {
    if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;

    const isActive = status === 'thinking' || status === 'preparing' || status === 'generating' || status === 'streaming' || status === 'applying';
    if (!isActive) return null;

    const thinkingStatus = status as ThinkingStatus;

    return (
        <div className={`ai-loading-indicator ai-loading-indicator--${status} ai-loading-indicator--variant-${variant} ${className}`} role="status" aria-live="polite" aria-busy="true">
            <div className="ai-loading-indicator-inner">
                <AIThinkingAnimation status={thinkingStatus} size={size} />
                {showStatusText && (
                    <div className="ai-loading-status-wrap">
                        <AIResponseStatus status={status} operation={operation} />
                    </div>
                )}
            </div>
        </div>
    );
};
