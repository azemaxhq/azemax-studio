import { Suspense, lazy, memo, useState, useEffect, useCallback } from 'react';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';
import { SettingsProvider } from './context/SettingsContext';
import { PerformanceProvider } from './context/PerformanceContext';
import { DialogProvider } from './components/UI/DialogProvider';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import { composeProviders } from './core/composeProviders';

import { AzemaxLogo } from './components/UI/AzemaxLogo';
import { BRAND } from './core/branding';
import { LandingPage } from './components/Landing/LandingPage';

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
  <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#0B0D10' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <AzemaxLogo size={40} />
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: '#F2F3F5', letterSpacing: '-0.01em' }}>{BRAND.name}</p>
        <p style={{ fontSize: '11px', color: '#707680', marginTop: '4px' }}>Loading workspace…</p>
      </div>
    </div>
  </div>
);

const AppProviders = composeProviders(
  DialogProvider,
  PerformanceProvider,
  ProjectProvider,
  TerminalProvider,
  ExplanationProvider,
  SettingsProvider,
);

function RootErrorFallback(error: Error) {
  return (
    <div style={{ padding: '40px', background: '#0B0D10', color: '#F2F3F5', minHeight: '100vh', fontFamily: 'ui-monospace, monospace' }}>
      <h1 style={{ color: '#DA3633', fontSize: '18px', marginBottom: '16px', fontWeight: 600 }}>Application Error</h1>
      <div style={{ background: '#101318', border: '1px solid #242830', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <p style={{ color: '#F2F3F5', fontSize: '13px', marginBottom: '8px' }}>{error.message}</p>
        <pre style={{ color: '#707680', fontSize: '11px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{error.stack}</pre>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: '20px', padding: '8px 14px', background: '#F2F3F5', color: '#0B0D10', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
      >
        Reload Page
      </button>
    </div>
  );
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname;
    }
    return '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToApp = useCallback(() => {
    window.history.pushState({}, '', '/app');
    setCurrentPath('/app');
    window.scrollTo(0, 0);
  }, []);

  // Isolate Landing Page from IDE Workspace:
  // Route /app (and /app/*) mounts the IDE workspace with all context providers.
  // Route / (and any other marketing route) renders the Azemax Landing Page.
  const isAppRoute = currentPath.startsWith('/app');

  if (!isAppRoute) {
    return (
      <ErrorBoundary fallback={RootErrorFallback}>
        <LandingPage onNavigateToApp={navigateToApp} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallback={RootErrorFallback}>
      <AppProviders>
        <AppContent />
      </AppProviders>
    </ErrorBoundary>
  );
}