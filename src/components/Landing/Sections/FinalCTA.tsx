import React from 'react';
import { ArrowRight, Terminal } from 'lucide-react';
import { useRevealAnimation } from '../hooks/useRevealAnimation';

interface FinalCTAProps {
  onEnterWorkspace: () => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onEnterWorkspace }) => {
  const eyebrowReveal = useRevealAnimation({ threshold: 0.2 });
  const headlineReveal = useRevealAnimation({ threshold: 0.15, delay: 100 });
  const bodyReveal = useRevealAnimation({ threshold: 0.12, delay: 200 });
  const ctaReveal = useRevealAnimation({ threshold: 0.1, delay: 350 });
  const badgesReveal = useRevealAnimation({ threshold: 0.1, delay: 500 });

  return (
    <section className="relative py-36 px-6 md:px-12 lg:px-16 bg-[#000204] overflow-hidden text-center flex flex-col items-center justify-center border-t border-[rgba(79,140,255,0.1)]">
      
      {/* Subtle Localized Planetary Blue Horizon Glow (Echoing Hero) */}
      <div 
        className="absolute bottom-[-160px] left-1/2 -translate-x-1/2 w-[1100px] h-[340px] rounded-t-[50%] bg-[radial-gradient(ellipse_at_top,rgba(79,140,255,0.16)_0%,rgba(14,30,58,0.08)_50%,transparent_80%)] pointer-events-none blur-3xl border-t border-[rgba(79,140,255,0.35)]"
        aria-hidden="true"
      />

      {/* Thin horizon curved line */}
      <div 
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1200px] h-1 bg-gradient-to-r from-transparent via-[#4F8CFF]/50 to-transparent pointer-events-none shadow-[0_0_24px_#4F8CFF]"
        aria-hidden="true"
      />

      {/* Additional atmospheric radial glow from center */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[radial-gradient(circle,rgba(79,140,255,0.05)_0%,transparent_60%)] pointer-events-none"
        aria-hidden="true"
      />

      <div className="max-w-4xl mx-auto relative z-10 flex flex-col items-center">
        
        {/* Eyebrow — Scroll Reveal */}
        <div
          ref={eyebrowReveal.ref}
          className={`flex items-center gap-3 mb-6 az-reveal ${eyebrowReveal.isVisible ? 'az-visible' : ''}`}
        >
          <span className="w-8 h-[1px] bg-[var(--az-blue-electric)] opacity-50" />
          <span className="az-mono-badge text-[11px] font-mono tracking-[0.25em] text-[#8FB4FF] uppercase">
            05 / INITIATION
          </span>
          <span className="w-8 h-[1px] bg-[var(--az-blue-electric)] opacity-50" />
        </div>

        {/* Campaign Headline — Scroll Reveal */}
        <h2
          ref={headlineReveal.ref}
          className={`text-5xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight text-white font-normal mb-8 leading-[1.04] az-reveal ${headlineReveal.isVisible ? 'az-visible' : ''}`}
        >
          <span className="az-display-serif block">Build</span>
          <span className="az-display-serif-italic az-text-shimmer block mt-1">
            beyond limits.
          </span>
        </h2>

        {/* Supporting Copy — Scroll Reveal */}
        <p
          ref={bodyReveal.ref}
          className={`text-base sm:text-lg text-[var(--az-muted)] font-normal leading-relaxed max-w-xl mb-12 font-sans az-reveal ${bodyReveal.isVisible ? 'az-visible' : ''}`}
        >
          The environment is ready. Open the workspace and start from where you left off.
          Writing, running, understanding, and improving code in one continuous flow.
        </p>

        {/* Action Controls — Scroll Reveal */}
        <div
          ref={ctaReveal.ref}
          className={`flex flex-wrap items-center justify-center gap-4 mb-16 az-reveal-scale ${ctaReveal.isVisible ? 'az-visible' : ''}`}
        >
          <button
            onClick={onEnterWorkspace}
            className="az-btn-primary group"
          >
            <span>Enter the workspace</span>
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
          </button>

          <a
            href="/app"
            className="az-btn-secondary flex items-center gap-2 group"
          >
            <Terminal size={14} className="text-[#8FB4FF]" />
            <span>Launch via CLI or Web</span>
          </a>
        </div>

        {/* Architectural Badges — Scroll Reveal */}
        <div
          ref={badgesReveal.ref}
          className={`flex flex-wrap items-center justify-center gap-6 text-[11px] font-mono text-[var(--az-muted)] border-t border-[rgba(255,255,255,0.06)] pt-8 w-full max-w-xl az-reveal ${badgesReveal.isVisible ? 'az-visible' : ''}`}
        >
          <span>v1.0.0 Stable</span>
          <span>•</span>
          <span>Zero Telemetry Leaks</span>
          <span>•</span>
          <span>Open Standards</span>
          <span>•</span>
          <span>Hardware Accelerated</span>
        </div>

      </div>
    </section>
  );
};
