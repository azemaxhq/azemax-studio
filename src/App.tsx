import { Suspense, lazy, memo } from 'react';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';
import { SettingsProvider } from './context/SettingsContext';
import { PerformanceProvider } from './context/PerformanceContext';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import { composeProviders } from './core/composeProviders';

import { AzemaxLogo } from './components/UI/AzemaxLogo';
import { BRAND } from './core/branding';

const MainLayout = lazy(() => import('./components/Layout/MainLayout').then(m => ({ default: m.MainLayout })));

// Memoized shell around the lazy layout: a SettingsProvider value change would
// otherwise re-render the ENTIRE MainLayout tree on every settings tweak. With
// this memo (no props), provider re-renders bail out here; components that
// actually consume settings still update via their own context/subscription.
const AppContent = memo(function AppContent() {
  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <MainLayout />
    </Suspense>
  );
});

const AppLoadingFallback = () => (
  <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      <AzemaxLogo size={44} />
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.01em' }}>{BRAND.name}</p>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>Loading workspace...</p>
      </div>
    </div>
  </div>
);

const AppProviders = composeProviders(
  PerformanceProvider,
  ProjectProvider,
  TerminalProvider,
  ExplanationProvider,
  SettingsProvider,
);

function RootErrorFallback(error: Error) {
  return (
    <div style={{ padding: '40px', background: '#0d1117', color: '#fff', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h1 style={{ color: '#f87171', fontSize: '24px', marginBottom: '16px' }}>🚨 Application Error</h1>
      <div style={{ background: '#1a1a2e', border: '1px solid #f87171', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <p style={{ color: '#fbbf24', fontSize: '16px', marginBottom: '8px' }}>{error.message}</p>
        <pre style={{ color: '#94a3b8', fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{error.stack}</pre>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: '20px', padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
      >
        Reload Page
      </button>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={RootErrorFallback}>
      <AppProviders>
        <AppContent />
      </AppProviders>
    </ErrorBoundary>
  );
}