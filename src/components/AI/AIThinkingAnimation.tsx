import React from 'react';

interface AIThinkingAnimationProps {
    status?: 'thinking' | 'generating' | 'streaming' | 'applying' | 'preparing';
    size?: 'sm' | 'md';
    className?: string;
}

/**
 * Premium orb + smooth fading dots — single set, no duplicate, 60fps.
 */
export const AIThinkingAnimation: React.FC<AIThinkingAnimationProps> = ({
    size = 'md',
    className = '',
}) => {
    return (
        <div className={`ai-thinking-root ${size === 'sm' ? 'ai-thinking--sm' : ''} ${className}`} aria-hidden="true">
            <div className="ai-thinking-icon">
                <div className="ai-thinking-glow" />
            </div>
            <div className="ai-thinking-dots" aria-hidden="true">
                <span className="ai-thinking-dot" />
                <span className="ai-thinking-dot" />
                <span className="ai-thinking-dot" />
            </div>
        </div>
    );
};
