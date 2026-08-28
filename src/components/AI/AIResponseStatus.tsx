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
    // Fallback to legacy status label if no operation provided (should not happen for new code)
    const fallback = !operation ? (() => {
        const map: Record<AILoadingStatus, string | null> = {
            idle: null,
            preparing: 'Preparing response…',
            thinking: 'Preparing response…',
            generating: 'Writing response…',
            streaming: 'Writing response…',
            applying: 'Applying changes…',
            success: null,
            error: null,
            cancelled: null,
        };
        return map[status] ?? null;
    })() : null;
    const finalLabel = label ?? fallback;
    if (!finalLabel) return null;
    return (
        <span className={`ai-response-status ai-response-status--${status} ${className}`}>
            <span className="ai-response-status-text">{finalLabel}</span>
        </span>
    );
};
