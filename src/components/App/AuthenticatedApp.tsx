import { Suspense, lazy, memo, useEffect } from 'react';
import { ProjectProvider } from '../../context/ProjectContext';
import { TerminalProvider } from '../../context/TerminalContext';
import { ExplanationProvider } from '../../context/ExplanationContext';
import { SettingsProvider } from '../../context/SettingsContext';
import { PerformanceProvider } from '../../context/PerformanceContext';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { AuthGate } from '../Auth/AuthGate';
import { AuthRoutes } from '../Auth/AuthRoutes';
import { DialogProvider } from '../UI/DialogProvider';
import { composeProviders } from '../../core/composeProviders';
import { ProviderProvider } from '../../core/ai/providerContext';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BRAND } from '../../core/branding';
import { wakeBackend } from '../../utils/backendHealth';
import { isAppRoutePath } from '../../utils/appRouter';

/**
 * Authenticated surface. This module is loaded lazily from App.tsx so the
 * landing and documentation pages never pay for Firebase, the IDE providers,
 * Monaco, or the terminal bundle.
 */

const MainLayout = lazy(() =>
  import('../Layout/MainLayout').then((m) => ({ default: m.MainLayout })),
);

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
  // Settings must sit above ProjectProvider: the settings store hydrates
  // synchronously per account, and project cloud sync reads the privacy
  // settings during its first render. Keeping it below would let the project
  // provider briefly observe the previous account's values.
  SettingsProvider,
  ProjectProvider,
  TerminalProvider,
  ExplanationProvider,
  // BYOK Provider context - provides active provider config to AIClient
  ProviderProvider,
);

// Workspace shell: Firebase authentication is the only way in (AuthGate renders
// the sign-in / verification panes otherwise). Providers are keyed by user id so
// ALL provider state (file tree, terminals, chat, settings caches) resets when
// the signed-in user changes — one account can never see another's state.
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
      <AppProviders key={user?.id ?? 'unauthenticated'}>
        <AppContent />
      </AppProviders>
    </AuthGate>
  );
}

/**
 * The AuthProvider instance is shared across /app and the auth routes so
 * authentication state (and the single Firebase listener) survives navigation
 * between the workspace and the sign-in / verification panes.
 */
export function AuthenticatedApp({ path }: { path: string }) {
  return (
    <AuthProvider>
      {isAppRoutePath(path) ? <WorkspaceShell /> : <AuthRoutes path={path} />}
    </AuthProvider>
  );
}
