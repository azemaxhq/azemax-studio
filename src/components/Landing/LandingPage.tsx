import React, { useLayoutEffect } from 'react';
import './Landing.css';
import { LandingNav } from './Navigation/LandingNav';
import { Hero } from './Hero/Hero';
import { Philosophy } from './Sections/Philosophy';
import { WorkspaceShowcase } from './Sections/WorkspaceShowcase';
import { ProductSystem } from './Sections/ProductSystem';
import { FinalCTA } from './Sections/FinalCTA';
import { LandingFooter } from './Footer/LandingFooter';

interface LandingPageProps {
  onNavigateToApp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigateToApp }) => {
  // Refresh must always land on the hero, never mid-page. Browsers restore
  // the previous scroll offset and/or jump to location.hash on reload — both
  // bypass React. We kill that early (before paint) and strip any hash so a
  // reload after clicking a nav pill (url = /#philosophy) still starts at hero.
  useLayoutEffect(() => {
    const html = document.documentElement;

    // Enable real page scroll for landing (overrides app's body/#root overflow:hidden)
    html.classList.add('az-landing-active');

    // Keep manual while landing is mounted; restore on unmount for /app.
    let prev: ScrollRestoration | null = null;
    if ('scrollRestoration' in history) {
      try {
        prev = history.scrollRestoration as ScrollRestoration;
        history.scrollRestoration = 'manual';
      } catch {}
    }

    // If URL carries a hash (e.g. /#philosophy after clicking nav), discard it
    // before the browser can auto-scroll to it. Deep-links via hash are not
    // part of this landing's UX — refresh is defined to return to hero.
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    // Instant, non-smooth reset before first paint to avoid flash of other section.
    html.classList.add('az-no-smooth');
    window.scrollTo(0, 0);

    // Re-enable smooth for in-page anchor clicks after two frames.
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => html.classList.remove('az-no-smooth'));
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      html.classList.remove('az-no-smooth');
      html.classList.remove('az-landing-active');
      if (prev !== null) {
        try { history.scrollRestoration = prev; } catch {}
      }
    };
  }, []);

  return (
    <div className="az-landing-root flex flex-col selection:bg-[#4F8CFF] selection:text-white">
      {/* Persistent Translucent Navigation (owns rAF-throttled scroll progress) */}
      <LandingNav onEnterWorkspace={onNavigateToApp} />

      {/* Main Continuous Narrative Stream */}
      <main id="main-content" className="flex-1 w-full flex flex-col">
        {/* 01 — ENTER: Planetary Horizon & Physical Hardware Hero */}
        <Hero onEnterWorkspace={onNavigateToApp} />

        {/* Animated Section Separator */}
        <div className="relative w-full h-8 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div className="az-section-separator" />
        </div>

        {/* 02 — THE CORE LOOP: Write -> Run -> Understand -> Improve */}
        <Philosophy />

        {/* Animated Section Separator */}
        <div className="relative w-full h-8 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div className="az-section-separator" />
        </div>

        {/* 03 — INTERACTIVE WORKSPACE: One environment, Four modes */}
        <WorkspaceShowcase />

        {/* Animated Section Separator */}
        <div className="relative w-full h-8 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <div className="az-section-separator" />
        </div>

        {/* 04 — ARCHITECTURAL UNIFICATION: The Machine Behind the File */}
        <ProductSystem />

        {/* 05 — RETURN TO BUILD: Final Campaign Call to Action */}
        <FinalCTA onEnterWorkspace={onNavigateToApp} />
      </main>

      {/* Minimal Landing Footer */}
      <LandingFooter onEnterWorkspace={onNavigateToApp} />
    </div>
  );
};
