import React from 'react';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';
import { getUserFacingStatus } from '../../core/ai/aiOperationStatus';

interface AIResponseStatusProps {
    status: AILoadingStatus;
    operation?: AIOperationType | string | null;
    className?: string;
}

export const AIResponseStatus: React.FC<AIResponseStatusProps> = ({ status, operation, className = '' }) => {
    const label = operation ? getUserFacingStatus(operation, status) : null;
    const fallback = !operation ? (() => {
        if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;
        return 'Working';
    })() : null;
    const finalLabel = label ?? fallback;
    if (!finalLabel) return null;
    return (
        <span className={`ai-response-status ai-response-status--${status} ${className}`}>
            <span className="ai-response-status-text">{finalLabel}</span>
        </span>
    );
};
