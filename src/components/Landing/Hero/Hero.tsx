import React, { memo, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import { PlanetCanvas } from '../Planet/PlanetCanvas';

interface HeroProps {
  onEnterWorkspace: () => void;
}

type DiscoveryMode = 'write' | 'run' | 'understand' | 'improve';

const DISCOVERY: { n: string; label: string; mode: DiscoveryMode }[] = [
  { n: '01', label: 'WRITE', mode: 'write' },
  { n: '02', label: 'RUN', mode: 'run' },
  { n: '03', label: 'UNDERSTAND', mode: 'understand' },
  { n: '04', label: 'IMPROVE', mode: 'improve' },
];

export const Hero: React.FC<HeroProps> = memo(({ onEnterWorkspace }) => {
  const handleDiscoveryClick = useCallback((mode: DiscoveryMode) => {
    // Preselect the matching tab in the Experience section, then let the
    // anchor carry the user there. Listener lives in WorkspaceShowcase.
    window.dispatchEvent(new CustomEvent<DiscoveryMode>('azemax:set-mode', { detail: mode }));
  }, []);

  const handleEnterWorkspace = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onEnterWorkspace();
    },
    [onEnterWorkspace],
  );

  return (
    <section className="relative min-h-[100svh] w-full flex flex-col pt-24 sm:pt-32 pb-10 sm:pb-12 px-4 sm:px-6 md:px-12 lg:px-16 overflow-hidden bg-[#000204]">
      {/* 1. Cinematic Multi-Layer Planetary Horizon Canvas (environment, not subject) */}
      <PlanetCanvas className="az-hero-planet" />

      {/* Atmospheric Horizon Gradient Wash into Content below */}
      <div
        className="absolute inset-x-0 bottom-0 h-48 pointer-events-none z-10 bg-gradient-to-b from-transparent via-[#000204]/70 to-[#000204]"
        aria-hidden="true"
      />

      {/* 2. Centered Hero Composition */}
      <div className="max-w-4xl mx-auto w-full flex flex-col items-center text-center relative z-20">

        {/* Eyebrow — cinematic chapter marker */}
        <div className="az-hero-eyebrow flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-2 text-center mb-5 sm:mb-7">
          <span className="w-6 h-[1px] bg-[var(--az-blue-electric)] opacity-60" />
          <span className="az-mono-badge text-[10px] font-mono tracking-[0.25em] text-[#8FB4FF] uppercase font-medium">
            BEYOND THE EDITOR
          </span>
          <span className="rounded-full border border-[#4F8CFF]/40 bg-[#4F8CFF]/10 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-[#8FB4FF]">
            Beta
          </span>
          <span className="w-6 h-[1px] bg-[var(--az-blue-electric)] opacity-60" />
        </div>

        {/* Main Campaign Headline */}
        <h1 className="az-hero-headline text-[2.25rem] min-[380px]:text-[2.75rem] leading-[1.02] sm:text-7xl md:text-8xl lg:text-[96px] tracking-[-0.03em] sm:leading-[0.98] text-white font-normal mb-5 sm:mb-6 text-balance select-none">
          <span className="az-display-serif block">Build</span>
          <span className="az-display-serif-italic az-text-blue block mt-1">
            beyond limits.
          </span>
        </h1>

        {/* Positioning statement + supporting copy */}
        <div className="az-hero-positioning mb-7 sm:mb-9 px-1">
          <p className="az-display-serif-italic text-lg sm:text-2xl text-white/90 leading-snug mb-3 text-balance">
            The space between thought and code.
          </p>
          <p className="text-sm sm:text-base text-[var(--az-muted)] font-normal leading-relaxed max-w-xl mx-auto font-sans text-balance">
            Write, run, understand, and improve code without leaving your flow.
          </p>
          <p className="mt-3 font-mono text-[10px] sm:text-[11px] tracking-[0.18em] uppercase text-[#8FB4FF]/80">
            Now in public beta — v1.0.0-beta
          </p>
        </div>

        {/* Call to Actions */}
        <div className="az-hero-cta flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-3 sm:gap-4 w-full sm:w-auto max-w-sm sm:max-w-none mx-auto">
          <a
            href="/app"
            onClick={handleEnterWorkspace}
            className="az-btn-primary group min-h-[44px] w-full sm:w-auto justify-center"
            id="hero-primary-cta"
          >
            <span>Enter Azemax</span>
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1 text-black/70" />
          </a>

          <a
            href="#modes"
            className="az-btn-secondary group min-h-[44px] w-full sm:w-auto justify-center"
          >
            <span>Explore the workspace</span>
            <span className="text-[var(--az-blue-pale)] group-hover:translate-y-0.5 transition-transform duration-200">↓</span>
          </a>
        </div>

        {/* 3. Discovery control — the core loop as navigation into the live demos */}
        <nav
          aria-label="Explore the Azemax loop"
          className="az-hero-metadata mt-6 sm:mt-9 grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-center gap-1 sm:gap-x-3 sm:gap-y-2 pt-5 sm:pt-6 border-t border-[rgba(255,255,255,0.06)] w-full max-w-md sm:max-w-none"
        >
          {DISCOVERY.map((item) => (
            <a
              key={item.mode}
              href="#modes"
              onClick={() => handleDiscoveryClick(item.mode)}
              data-discovery-mode={item.mode}
              className="az-discovery-item group flex items-center justify-center gap-2 px-2 sm:px-3 py-3 min-h-[44px] rounded-md font-mono text-[10px] sm:text-[11px] tracking-[0.18em] text-[var(--az-muted)] transition-[color,background-color,transform] duration-200 hover:text-white hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF]/70"
            >
              <span className="text-white/25 text-[10px] group-hover:text-[#8FB4FF] transition-colors duration-200">
                {item.n}
              </span>
              <span>{item.label}</span>
              <span
                aria-hidden="true"
                className="h-1 w-1 rounded-full bg-[#4F8CFF] opacity-0 scale-50 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:scale-100"
              />
            </a>
          ))}
        </nav>
      </div>
    </section>
  );
});

Hero.displayName = 'Hero';
