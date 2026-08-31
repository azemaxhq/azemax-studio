import React from 'react';
import type { AILoadingStatus } from '../../hooks/useAILoading';
import type { AIOperationType } from '../../core/ai/aiRequestStore';
import { getAIActivityLabel, AZEMAX_ROTATION_POOL } from './aiActivityLabel';

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
    const [displayLabel, setDisplayLabel] = React.useState('Azemaxing');
    const labelRafRef = React.useRef<number | null>(null);
    const rotationRef = React.useRef<number | null>(null);
    const rotationIndexRef = React.useRef(0);

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
            // reset rotation to label's position in pool
            const idx = AZEMAX_ROTATION_POOL.indexOf(label as typeof AZEMAX_ROTATION_POOL[number]);
            rotationIndexRef.current = idx >= 0 ? idx : 0;
        }
    }, [label, displayLabel]);

    // Calm rotation while processing — every 3.2s, no layout shift, respects reduced-motion
    React.useEffect(() => {
        if (!isActive || !shouldRender) {
            if (rotationRef.current) window.clearInterval(rotationRef.current);
            rotationRef.current = null;
            return;
        }
        if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        // start after 2.8s, then every 3.2s
        const startDelay = window.setTimeout(() => {
            rotationRef.current = window.setInterval(() => {
                rotationIndexRef.current = (rotationIndexRef.current + 1) % AZEMAX_ROTATION_POOL.length;
                const next = AZEMAX_ROTATION_POOL[rotationIndexRef.current];
                // only rotate among neutral signature phrases to avoid fake context
                if (labelRafRef.current) cancelAnimationFrame(labelRafRef.current);
                labelRafRef.current = requestAnimationFrame(() => setDisplayLabel(next));
            }, 3200);
        }, 2800);
        return () => {
            window.clearTimeout(startDelay);
            if (rotationRef.current) window.clearInterval(rotationRef.current);
            rotationRef.current = null;
        };
    }, [isActive, shouldRender]);

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
            {showStatusText && (
                <span
                    className="ai-loading-minimal-text"
                    style={{
                        transition: 'opacity 220ms ease',
                        maxWidth: 180,
                        display: 'inline-block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'middle',
                        flexShrink: 0,
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
