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
 * Minimal premium loader — tiny pulse dot + status text, no pill, 60fps.
 * Replaces the heavy orb-pill with a subtle inline indicator.
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
        <div className={`ai-loading-minimal ${className}`} role="status" aria-live="polite" aria-busy="true">
            <span className="ai-loading-minimal-dot" aria-hidden="true" />
            {showStatusText && (
                <span className="ai-loading-minimal-text">
                    <AIResponseStatus status={status} operation={operation} />
                </span>
            )}
        </div>
    );
};
