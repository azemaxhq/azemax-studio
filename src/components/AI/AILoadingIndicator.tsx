import React from 'react';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';
import type { AgentTaskPhase } from '../../core/ai/aiRequestStore';
import { getAIActivityLabel } from './aiActivityLabel';
import { AIActivityIndicator } from './AIActivityIndicator';

interface AILoadingIndicatorProps {
    status: AILoadingStatus;
    operation?: AIOperationType | string | null;
    /** Explicit agent lifecycle phase — the most truthful "what is it doing" signal. */
    phase?: AgentTaskPhase | null;
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
 * Azemax AI-native loading — one stable mark + one truthful status line.
 *
 * The label is derived synchronously from real execution signals
 * (active tool → lifecycle phase → neutral fallback) via the centralized
 * formatter. No rotation timers, no simulated progress: the mark animates
 * continuously on its own and is never restarted when the label changes.
 */
export const AILoadingIndicator: React.FC<AILoadingIndicatorProps> = ({
    status,
    operation,
    phase,
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

    // Pure derivation — recomputed only when a real signal changes.
    const label = React.useMemo(
        () =>
            getAIActivityLabel({
                prompt: prompt || undefined,
                intent: prompt || undefined,
                operation: operation || undefined,
                phase: status as AILoadingStatus,
                agentPhase: phase || undefined,
                fileName: fileName || undefined,
                hasSelection: !!hasSelection,
                activeTool: activeTool || undefined,
                isApplying: status === 'applying',
            }),
        [prompt, operation, status, phase, fileName, hasSelection, activeTool],
    );

    // Entrance runs once per activation; label updates never touch the mark.
    React.useEffect(() => {
        if (isActive) {
            setShouldRender(true);
            setVisible(false);
            const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
            return () => cancelAnimationFrame(raf);
        }
        setVisible(false);
        const t = setTimeout(() => setShouldRender(false), 180);
        return () => clearTimeout(t);
    }, [isActive]);

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
                transition: 'opacity 180ms var(--az-ease-out, cubic-bezier(0.16,1,0.3,1)), transform 180ms var(--az-ease-out, cubic-bezier(0.16,1,0.3,1))',
            }}
        >
            <AIActivityIndicator size={22} />
            {showStatusText && (
                <span className="ai-loading-minimal-text" aria-label={label}>
                    {label}
                </span>
            )}
        </div>
    );
};
