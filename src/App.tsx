import { Suspense, lazy, memo, useState, useEffect, useCallback } from 'react';
import { ProjectProvider } from './context/ProjectContext';
import { TerminalProvider } from './context/TerminalContext';
import { ExplanationProvider } from './context/ExplanationContext';
import { SettingsProvider } from './context/SettingsContext';
import { PerformanceProvider } from './context/PerformanceContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthGate } from './components/Auth/AuthGate';
import { DialogProvider } from './components/UI/DialogProvider';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import { composeProviders } from './core/composeProviders';

import { AzemaxLogo } from './components/UI/AzemaxLogo';
import { BRAND } from './core/branding';
import { LandingPage } from './components/Landing/LandingPage';
import { wakeBackend } from './utils/backendHealth';
import { ANON_USER_ID, isAppRoutePath } from './utils/betaAccess';

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
  <div style={{ display: 'flex', height: '100vh', width: '100%', alignItems: 'center', justifyContent: 'center', background: '#080F1C' }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <AzemaxLogo size={40} />
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: '#E6EDF8', letterSpacing: '-0.01em' }}>{BRAND.name}</p>
        <p style={{ fontSize: '11px', color: '#72849F', marginTop: '4px' }}>Loading workspace…</p>
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

// Workspace shell: open to everyone in public beta (AuthGate no longer blocks
// anonymous visitors), and keyed by user id so ALL provider state (file tree,
// terminals, chat, settings caches) resets when the signed-in user changes.
// Anonymous visitors share the STABLE 'beta-anon' key: local workspace data
// persists across refreshes and direct /app navigation, isolated from every
// real account by construction. No cross-user state leakage.
function WorkspaceShell() {
  const { user } = useAuth();
  // Background warm-up for a cold (Render free-tier) backend: one lightweight
  // GET to /api/health, fired as soon as the editor initializes — before the
  // lazy MainLayout chunk even loads. Fire-and-forget and non-blocking; the
  // singleton in backendHealth dedupes StrictMode / remount calls and never
  // retries, polls, or touches AI providers.
  useEffect(() => {
    wakeBackend();
  }, []);
  return (
    <AuthGate>
      <AppProviders key={user ? user.id : ANON_USER_ID}>
        <AppContent />
      </AppProviders>
    </AuthGate>
  );
}

function RootErrorFallback(error: Error) {
  return (
    <div style={{ padding: '40px', background: '#080F1C', color: '#E6EDF8', minHeight: '100vh', fontFamily: 'ui-monospace, monospace' }}>
      <h1 style={{ color: '#FF7D8B', fontSize: '18px', marginBottom: '16px', fontWeight: 600 }}>Application Error</h1>
      <div style={{ background: '#0A1322', border: '1px solid rgba(230,237,248,0.075)', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
        <p style={{ color: '#E6EDF8', fontSize: '13px', marginBottom: '8px' }}>{error.message}</p>
        <pre style={{ color: '#72849F', fontSize: '11px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{error.stack}</pre>
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{ marginTop: '20px', padding: '8px 14px', background: '#5B8CFF', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}
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
  // Direct navigation to /app always reaches the workspace — public beta has
  // no login redirect (see isAppRoutePath, unit-tested).
  const isAppRoute = isAppRoutePath(currentPath);

  if (!isAppRoute) {
    return (
      <ErrorBoundary fallback={RootErrorFallback}>
        <LandingPage onNavigateToApp={navigateToApp} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallback={RootErrorFallback}>
      <AuthProvider>
        <WorkspaceShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}