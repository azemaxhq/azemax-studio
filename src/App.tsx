import React, { Suspense, lazy, Component, type ReactNode, type ErrorInfo } from 'react';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';
import { SettingsProvider } from './context/SettingsContext';
import { PerformanceProvider } from './context/PerformanceContext';

const MainLayout = lazy(() => import('./components/Layout/MainLayout').then(m => ({ default: m.MainLayout })));

const AppLoadingFallback = () => (
  <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', border: '4px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', animation: 'spin 1s linear infinite' }} />
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '18px', fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>DeepContext</p>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>Loading editor...</p>
      </div>
    </div>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// Error Boundary to catch and display runtime errors
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', background: '#0d1117', color: '#fff', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h1 style={{ color: '#f87171', fontSize: '24px', marginBottom: '16px' }}>🚨 Application Error</h1>
          <div style={{ background: '#1a1a2e', border: '1px solid #f87171', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
            <p style={{ color: '#fbbf24', fontSize: '16px', marginBottom: '8px' }}>{this.state.error?.message}</p>
            <pre style={{ color: '#94a3b8', fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {this.state.error?.stack}
            </pre>
          </div>
          {this.state.errorInfo && (
            <details style={{ marginTop: '16px' }}>
              <summary style={{ color: '#60a5fa', cursor: 'pointer' }}>Component Stack</summary>
              <pre style={{ color: '#94a3b8', fontSize: '12px', marginTop: '8px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '20px', padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <PerformanceProvider>
        <ProjectProvider>
          <TerminalProvider>
            <ExplanationProvider>
              <SettingsProvider>
                <Suspense fallback={<AppLoadingFallback />}>
                  <MainLayout />
                </Suspense>
              </SettingsProvider>
            </ExplanationProvider>
          </TerminalProvider>
        </ProjectProvider>
      </PerformanceProvider>
    </ErrorBoundary>
  );
}