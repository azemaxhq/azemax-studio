import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Custom fallback: node, or function receiving the caught error. */
    fallback?: ReactNode | ((error: Error) => ReactNode);
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Reusable error boundary. Contains a failed subtree (e.g. the file explorer,
 * an AI panel, markdown renderer) so one malformed piece of data can never
 * take down the whole application. Real errors are logged for diagnostics.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[ErrorBoundary] Caught error:', error, info);
        this.props.onError?.(error, info);
    }

    render() {
        const { error } = this.state;
        if (error) {
            if (this.props.fallback) {
                return typeof this.props.fallback === 'function'
                    ? this.props.fallback(error)
                    : this.props.fallback;
            }
            return (
                <div
                    style={{
                        padding: '16px 20px',
                        color: '#e2e8f0',
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: '12px',
                        background: 'rgba(248,113,113,0.05)',
                        border: '1px solid rgba(248,113,113,0.2)',
                        borderRadius: '8px',
                        margin: '8px',
                    }}
                >
                    <div style={{ color: '#f87171', fontWeight: 600, marginBottom: 6 }}>
                        Something went wrong in this section
                    </div>
                    <div style={{ color: '#94a3b8' }}>{error.message || String(error)}</div>
                </div>
            );
        }
        return this.props.children;
    }
}
