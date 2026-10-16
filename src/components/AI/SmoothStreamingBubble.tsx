import React, { useEffect, useRef } from 'react';
import { MarkdownRenderer } from '../Panels/MarkdownRenderer';

interface Props {
    text: string;
    isStreaming: boolean;
    components?: React.ComponentProps<typeof MarkdownRenderer>['components'];
}

/**
 * Premium smooth streaming bubble.
 * - 60fps: only opacity/transform (will-change), no layout thrash
 * - content-visibility + contain for no jump
 * - skeleton shimmer before first token, seamless handoff to streaming
 * - reduced-motion disables shimmer/caret
 */
export const SmoothStreamingBubble: React.FC<Props> = ({ text, isStreaming, components }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const prevLengthRef = useRef(0);

    // Add streaming-content class only when text grows > 20 chars to avoid flashing on tiny deltas
    const shouldAnimate = text.length > 20 && text.length !== prevLengthRef.current;
    useEffect(() => {
        prevLengthRef.current = text.length;
    }, [text.length]);

    // No skeleton — compact contextual loading is handled by unified AILoadingIndicator.
    // Return null while no real content exists so the conversation doesn't show a giant blank placeholder.
    if (!text || !text.trim()) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className={`smooth-streaming-content ${shouldAnimate ? '' : ''}`}
            style={{ contain: 'layout paint', willChange: 'opacity, transform' }}
        >
            <div className="text-[15px] leading-[1.8] text-[#DCE6F5] break-words">
                <MarkdownRenderer components={components} isStreaming={isStreaming}>
                    {text}
                </MarkdownRenderer>
                {isStreaming && <span className="streaming-caret-premium" aria-hidden="true" />}
            </div>
        </div>
    );
};
