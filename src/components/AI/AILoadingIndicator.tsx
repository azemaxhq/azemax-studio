import React from 'react';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';
import { getAIActivityLabel } from './aiActivityLabel';

interface AILoadingIndicatorProps {
    status: AILoadingStatus;
    operation?: AIOperationType | string | null;
    prompt?: string | null;
    fileName?: string | null;
    activeTool?: { name: string; target?: string; label?: string } | null;
    hasSelection?: boolean;
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
    prompt,
    fileName,
    activeTool,
    hasSelection,
    className = '',
    showStatusText = true,
}) => {
    const isActive = status === 'thinking' || status === 'preparing' || status === 'generating' || status === 'streaming' || status === 'applying';
    const [visible, setVisible] = React.useState(false);
    const [shouldRender, setShouldRender] = React.useState(false);
    const [displayLabel, setDisplayLabel] = React.useState('Working');
    const labelRafRef = React.useRef<number | null>(null);

    const label = getAIActivityLabel({
        prompt: prompt || undefined,
        intent: prompt || undefined,
        operation: operation || undefined,
        phase: status as any,
        fileName: fileName || undefined,
        hasSelection: !!hasSelection,
        activeTool: activeTool || undefined,
        isApplying: status === 'applying',
    });

    React.useEffect(() => {
        if (isActive) {
            setShouldRender(true);
            setVisible(false);
            requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
        } else {
            setVisible(false);
            const t = setTimeout(() => setShouldRender(false), 180);
            return () => clearTimeout(t);
        }
    }, [isActive]);

    React.useEffect(() => {
        if (label !== displayLabel) {
            if (labelRafRef.current) cancelAnimationFrame(labelRafRef.current);
            labelRafRef.current = requestAnimationFrame(() => setDisplayLabel(label));
        }
    }, [label, displayLabel]);

    if (!shouldRender) return null;

    return (
        <div
            className={`ai-loading-minimal ${className}`}
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(3px)',
                transition: 'opacity 180ms ease, transform 180ms ease',
            }}
        >
            {showStatusText && (
                <span
                    className="ai-loading-minimal-text"
                    style={{
                        transition: 'opacity 160ms ease, transform 160ms ease',
                        minWidth: 140,
                        display: 'inline-block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {displayLabel}
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
