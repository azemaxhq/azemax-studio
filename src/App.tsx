import { Suspense, lazy, useState, useEffect } from 'react';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import { AzemaxLogo } from './components/UI/AzemaxLogo';
import { BRAND } from './core/branding';
import { LandingPage } from './components/Landing/LandingPage';
import { NotFoundPage } from './components/Public/NotFoundPage';
import { resolveRoute } from './seo/site';
import { applyRouteMeta } from './seo/applyMeta';
import { navigate } from './utils/appRouter';

// Public content documents are prerendered to standalone HTML with no module
// script (see scripts/prerender.mjs), so a direct visit downloads no React at
// all. These lazy imports are only used when the user reaches a content page
// through in-app navigation from the landing page.
const LegalPage = lazy(() =>
  import('./components/Legal/LegalPage').then((m) => ({ default: m.LegalPage })),
);
const FeaturesPage = lazy(() =>
  import('./components/Public/FeaturesPage').then((m) => ({ default: m.FeaturesPage })),
);
const DocsPage = lazy(() =>
  import('./components/Public/DocsPage').then((m) => ({ default: m.DocsPage })),
);
const FaqPage = lazy(() =>
  import('./components/Public/FaqPage').then((m) => ({ default: m.FaqPage })),
);
const ContactPage = lazy(() =>
  import('./components/Public/ContactPage').then((m) => ({ default: m.ContactPage })),
);

// Firebase, the IDE providers, Monaco, and the terminal all live behind this
// boundary. They are never part of the landing bundle.
const AuthenticatedApp = lazy(() =>
  import('./components/App/AuthenticatedApp').then((m) => ({ default: m.AuthenticatedApp })),
);

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
        style={{ marginTop: '20px', padding: '8px 14px', background: '#5B8CFF', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
      >
        Reload Page
      </button>
    </div>
  );
}

function LoadingWorkspace({ label = 'Opening workspace…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#080F1C] text-[#E6EDF8]">
      <div className="flex flex-col items-center gap-4">
        <AzemaxLogo size={40} />
        <div className="text-center">
          <p className="text-[13px] font-semibold tracking-[-0.01em]">{BRAND.name}</p>
          <p className="mt-1 text-[11px] text-[#72849F]">{label}</p>
        </div>
      </div>
    </div>
  );
}

/** Resolve a public pathname to its page component. */
function PublicRoute({ path }: { path: string }) {
  const route = resolveRoute(path);
  if (route.kind !== 'public') return null;

  const { page } = route;

  if (page.key === 'home') {
    return (
      <LandingPage
        onNavigateToApp={() => navigate('/app')}
        onSignIn={() => navigate('/login')}
      />
    );
  }

  if (page.key === 'privacy' || page.key === 'terms') {
    return <LegalPage path={page.path} />;
  }

  return (
    <Suspense fallback={<LoadingWorkspace label="Loading page…" />}>
      {page.key === 'features' ? <FeaturesPage /> : null}
      {page.key === 'docs' ? <DocsPage /> : null}
      {page.key === 'faq' ? <FaqPage /> : null}
      {page.key === 'contact' ? <ContactPage /> : null}
    </Suspense>
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

  // Keep titles, canonicals, robots, Open Graph, and JSON-LD correct for SPA
  // navigations. On a prerendered page these values are already correct, and
  // this call is idempotent.
  useEffect(() => {
    applyRouteMeta(currentPath);
  }, [currentPath]);

  // Intercept same-origin links for SPA navigation. External links, hash-only
  // anchors, mailto/tel, downloads, and modified clicks keep native behavior.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.getAttribute('rel')?.split(/\s+/).includes('external')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // Same document (including query-only changes) — let the browser handle.
      if (url.pathname === window.location.pathname) return;

      event.preventDefault();
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const route = resolveRoute(currentPath);

  return (
    <ErrorBoundary fallback={RootErrorFallback}>
      {route.kind === 'public' ? (
        <Suspense fallback={<LoadingWorkspace label="Loading page…" />}>
          <PublicRoute path={currentPath} />
        </Suspense>
      ) : route.kind === 'private' ? (
        <Suspense fallback={<LoadingWorkspace />}>
          <AuthenticatedApp path={currentPath} />
        </Suspense>
      ) : (
        <NotFoundPage />
      )}
    </ErrorBoundary>
  );
}
