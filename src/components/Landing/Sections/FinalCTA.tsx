import React, { memo } from 'react';
import { ArrowRight, Terminal } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

interface FinalCTAProps {
  onEnterWorkspace: () => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = memo(({ onEnterWorkspace }) => {
  // Consolidated scroll reveal hook: 1 render instead of 5
  const [sectionTarget, isVisible] = useRevealAnimation({ threshold: 0.1 });

  return (
    <div ref={sectionTarget} className="relative py-20 sm:py-28 lg:py-36 px-4 sm:px-6 md:px-12 lg:px-16 bg-[#000204] overflow-hidden text-center flex flex-col items-center justify-center border-t border-[rgba(79,140,255,0.1)]">

      {/* Subtle Localized Planetary Blue Horizon Glow (Echoing Hero) — compositor-only */}
      <div
        className="az-atmosphere absolute bottom-[-160px] left-1/2 -translate-x-1/2 w-[100vw] max-w-[1100px] h-[340px] rounded-t-[50%] bg-[radial-gradient(ellipse_at_top,rgba(79,140,255,0.16)_0%,rgba(14,30,58,0.08)_50%,transparent_80%)] pointer-events-none blur-3xl border-t border-[rgba(79,140,255,0.35)]"
        aria-hidden="true"
      />

      {/* Thin horizon curved line — transform-only, no shadow repaint on scroll */}
      <div
        className="az-horizon-line absolute bottom-0 left-1/2 -translate-x-1/2 w-[100vw] max-w-[1200px] h-1 bg-gradient-to-r from-transparent via-[#4F8CFF]/50 to-transparent pointer-events-none"
        aria-hidden="true"
      />

      {/* Additional atmospheric radial glow from center — compositor-only */}
      <div
        className="az-atmosphere absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100vw] max-w-[600px] h-[300px] bg-[radial-gradient(circle,rgba(79,140,255,0.05)_0%,transparent_60%)] pointer-events-none"
        aria-hidden="true"
      />

      <div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center">
        
        {/* Eyebrow — Scroll Reveal */}
        <div
          className={`flex items-center gap-3 mb-6 az-reveal ${isVisible ? 'az-visible' : ''}`}
        >
          <span className="w-8 h-[1px] bg-[var(--az-blue-electric)] opacity-50" />
          <span className="az-mono-badge text-[11px] font-mono tracking-[0.25em] text-[#8FB4FF] uppercase">
            05 / INITIATION
          </span>
          <span className="w-8 h-[1px] bg-[var(--az-blue-electric)] opacity-50" />
        </div>

        {/* Campaign Headline — Scroll Reveal */}
        <h2
          className={`text-4xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight text-white font-normal mb-6 sm:mb-8 leading-[1.06] sm:leading-[1.04] text-balance az-reveal az-delay-1 ${isVisible ? 'az-visible' : ''}`}
        >
          <span className="az-display-serif block">Build</span>
          <span className="az-display-serif-italic az-text-shimmer block mt-1">
            beyond limits.
          </span>
        </h2>

        {/* Supporting Copy — Scroll Reveal */}
        <p
          className={`text-[15px] sm:text-lg text-[var(--az-muted)] font-normal leading-relaxed max-w-xl px-1 mb-8 sm:mb-12 font-sans text-balance az-reveal az-delay-2 ${isVisible ? 'az-visible' : ''}`}
        >
          The environment is ready. Open the workspace and start from where you left off.
          Writing, running, understanding, and improving code in one continuous flow.
          Currently in public beta — expect rapid improvements.
        </p>

        {/* Action Controls — Scroll Reveal */}
        <div
          className={`flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-center gap-3 sm:gap-4 w-full sm:w-auto max-w-sm sm:max-w-none mx-auto mb-10 sm:mb-16 az-reveal-scale az-delay-3 ${isVisible ? 'az-visible' : ''}`}
        >
          <button
            onClick={onEnterWorkspace}
            className="az-btn-primary group min-h-[44px] w-full sm:w-auto justify-center"
          >
            <span>Enter the workspace</span>
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
          </button>

          <a
            href="/app"
            className="az-btn-secondary flex items-center justify-center gap-2 group min-h-[44px] w-full sm:w-auto"
          >
            <Terminal size={14} className="text-[#8FB4FF]" />
            <span>Launch via CLI or Web</span>
          </a>
        </div>

        {/* Architectural Badges — Scroll Reveal */}
        <div
          className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-6 px-2 text-[11px] font-mono text-[var(--az-muted)] border-t border-[rgba(255,255,255,0.06)] pt-6 sm:pt-8 w-full max-w-xl az-reveal az-delay-4 ${isVisible ? 'az-visible' : ''}`}
        >
          <span>v1.0.0-beta</span>
          <span aria-hidden="true">•</span>
          <span>Zero Telemetry Leaks</span>
          <span aria-hidden="true" className="hidden sm:inline">•</span>
          <span>Open Standards</span>
          <span aria-hidden="true">•</span>
          <span>Hardware Accelerated</span>
        </div>

      </div>
    </div>
  );
});

FinalCTA.displayName = 'FinalCTA';
