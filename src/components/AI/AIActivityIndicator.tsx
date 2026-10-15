import React from 'react';

interface AIActivityIndicatorProps {
    /** Icon box in px. Inline chat activities use ~22. */
    size?: number;
    className?: string;
}

/**
 * Azemax activity visualization — a fluid computational signal.
 *
 * ONE primary continuous path: a smooth left-to-right current with a single
 * S-inflection (crest → trough → lift), drawn with rounded caps. Segment
 * joins share horizontal tangents, so the whole form is C1-smooth — one
 * connected flow, never disconnected strokes, rings, or logo shapes.
 *
 * Motion: a short luminous highlight travels the path via a seamless 3s
 * dash-offset cycle (pathLength=100, periodic so the loop has no reset), over
 * a muted full-path base. No rotation, no scaling, no bounce, no glow
 * filters, no JS loops.
 *
 * Inline SVG (no icon library, no text glyph) so geometry is identical on
 * every platform.
 *
 * Decorative (aria-hidden); the adjacent activity label carries meaning and
 * the surrounding role="status" container handles announcements.
 */
export const AIActivityIndicator: React.FC<AIActivityIndicatorProps> = React.memo(({
    size = 22,
    className = '',
}) => (
    <span
        className={`ai-activity-mark ${className}`}
        aria-hidden="true"
        style={{ width: size, height: size }}
    >
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
        >
            {/* Muted base — the full current at rest. */}
            <path
                className="az-track"
                pathLength={100}
                d="M3.5 13.2 C6.8 13.2 7.2 8.6 10.8 8.6 C14.4 8.6 13.8 15.4 17.4 15.4 C19.4 15.4 20 14.2 21.5 13.6"
            />
            {/* Travelling highlight — same path, a short bright segment. */}
            <path
                className="az-sweep"
                pathLength={100}
                d="M3.5 13.2 C6.8 13.2 7.2 8.6 10.8 8.6 C14.4 8.6 13.8 15.4 17.4 15.4 C19.4 15.4 20 14.2 21.5 13.6"
            />
        </svg>
    </span>
));
