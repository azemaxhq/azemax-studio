import React from 'react';

interface AIStreamingIndicatorProps {
    active?: boolean;
    className?: string;
}

/**
 * Subtle streaming cursor — appears while AI is streaming, disappears smoothly on completion.
 * No typewriter delay, no layout jump.
 */
export const AIStreamingIndicator: React.FC<AIStreamingIndicatorProps> = ({ active = true, className = '' }) => {
    if (!active) return null;
    return (
        <span className={`ai-streaming-cursor ${className}`} aria-hidden="true">
            <span className="ai-streaming-caret" />
        </span>
    );
};
