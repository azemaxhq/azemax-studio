import { useBackendHealth } from '../../hooks/useBackendHealth';

/**
 * Subtle, non-intrusive warm-up pill. Visible ONLY while backend
 * connectivity is being established (`connecting`).
 *
 * - Never shows a "Connected" state (nothing renders once `ready`).
 * - Never shows an error: timeouts and network failures during a cold start
 *   resolve silently — the editor stays fully usable.
 * - `pointer-events-none` on the parent keeps it from intercepting editor
 *   input; `role="status"` announces politely to assistive tech.
 */
export function BackendStatusIndicator() {
    const status = useBackendHealth();
    if (status !== 'connecting') return null;
    return (
        <div
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-tight shadow-lg backdrop-blur-md"
            style={{
                background: 'rgba(14, 17, 22, 0.82)',
                border: '1px solid rgba(230,237,248,0.08)',
                color: 'rgba(230,237,248,0.62)',
            }}
        >
            <span
                aria-hidden="true"
                className="az-loading-pulse inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: 'var(--az-accent)' }}
            />
            <span>Connecting to AI services…</span>
        </div>
    );
}
