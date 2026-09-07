import React from 'react';
import { ArrowRight } from 'lucide-react';
import { PlanetCanvas } from '../Planet/PlanetCanvas';

interface HeroProps {
  onEnterWorkspace: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onEnterWorkspace }) => {
  return (
    <section className="relative min-h-[92vh] sm:min-h-screen w-full flex flex-col justify-between pt-32 sm:pt-36 pb-16 px-6 md:px-12 lg:px-16 overflow-hidden bg-[#000204]">
      {/* 1. Cinematic Multi-Layer Planetary Horizon Canvas */}
      <PlanetCanvas />

      {/* Atmospheric Horizon Gradient Wash into Content below */}
      <div
        className="absolute inset-x-0 bottom-0 h-40 pointer-events-none z-10 bg-gradient-to-b from-transparent via-[#000204]/70 to-[#000204]"
        aria-hidden="true"
      />

      {/* 2. Centered Hero Composition */}
      <div className="max-w-4xl mx-auto w-full flex flex-col items-center text-center relative z-20 my-auto">

        {/* Eyebrow with hairline technical rules — ANIMATED */}
        <div className="az-hero-eyebrow flex items-center justify-center gap-3 mb-6 sm:mb-8">
          <span className="w-6 h-[1px] bg-[var(--az-blue-electric)] opacity-60" />
          <span className="az-mono-badge text-[10px] font-mono tracking-[0.25em] text-[#8FB4FF] uppercase font-medium">
            BEYOND THE EDITOR
          </span>
          <span className="w-6 h-[1px] bg-[var(--az-blue-electric)] opacity-60" />
        </div>

        {/* Main Campaign Headline — ANIMATED */}
        <h1 className="az-hero-headline text-6xl sm:text-7xl md:text-8xl lg:text-[96px] tracking-[-0.03em] leading-[0.98] text-white font-normal mb-8 select-none">
          <span className="az-display-serif block">Build</span>
          <span className="az-display-serif-italic az-text-blue block mt-1">
            beyond limits.
          </span>
        </h1>

        {/* Subtitle & Narrative — ANIMATED */}
        <p className="az-hero-subtitle text-base sm:text-lg text-[var(--az-muted)] font-normal leading-relaxed max-w-xl mb-10 font-sans">
          An intelligent developer workspace for writing, running, understanding, and improving code.
        </p>

        {/* Call to Actions — ANIMATED */}
        <div className="az-hero-cta flex flex-wrap items-center justify-center gap-4 mb-14">
          <a
            href="/app"
            onClick={(e) => {
              e.preventDefault();
              onEnterWorkspace();
            }}
            className="az-btn-primary group"
            id="hero-primary-cta"
          >
            <span>Enter the workspace</span>
            <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-1 text-black/70" />
          </a>

          <a
            href="#philosophy"
            className="az-btn-secondary group"
          >
            <span>Explore the experience</span>
            <span className="text-[var(--az-blue-pale)] group-hover:translate-y-0.5 transition-transform duration-200">↓</span>
          </a>
        </div>

        {/* Hero Microdetails / Metadata — ANIMATED */}
        <div className="az-hero-metadata flex flex-wrap items-center justify-center gap-y-2 gap-x-6 pt-6 border-t border-[rgba(255,255,255,0.06)] text-[11px] font-mono text-[var(--az-muted)] tracking-wider">
          <span>WRITE</span>
          <span className="text-white/20">•</span>
          <span>RUN</span>
          <span className="text-white/20">•</span>
          <span>UNDERSTAND</span>
          <span className="text-white/20">•</span>
          <span>IMPROVE</span>
        </div>
      </div>

    </section>
  );
};
