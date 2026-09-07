import React from 'react';
import { BRAND } from '../../../core/branding';

interface LandingFooterProps {
  onEnterWorkspace: () => void;
}

export const LandingFooter: React.FC<LandingFooterProps> = ({ onEnterWorkspace }) => {
  return (
    <footer className="py-16 px-6 md:px-12 lg:px-16 bg-[#000204] border-t border-[rgba(255,255,255,0.06)] relative z-20 text-xs text-[var(--az-muted)] font-mono">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
        
        {/* Brand & Tagline */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <img
              src={BRAND.logoSrc}
              alt={BRAND.name}
              width={20}
              height={20}
              className="w-5 h-5 object-contain shrink-0"
              style={{ width: '20px', height: '20px', maxWidth: '20px', maxHeight: '20px' }}
            />
            <span className="font-semibold text-white tracking-widest uppercase">
              {BRAND.name}
            </span>
          </div>
          <span className="hidden sm:inline text-white/20">|</span>
          <span className="font-sans text-[var(--az-muted)]">
            Build beyond limits.
          </span>
        </div>

        {/* Minimal Navigation */}
        <div className="flex flex-wrap items-center justify-center gap-6">
          <button
            onClick={onEnterWorkspace}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Workspace
          </button>
          <a href="#philosophy" className="hover:text-white transition-colors">
            Loop
          </a>
          <a href="#modes" className="hover:text-white transition-colors">
            Modes
          </a>
          <a href="#system" className="hover:text-white transition-colors">
            Architecture
          </a>
        </div>

        {/* Technical Stamp */}
        <div className="text-[11px] text-[var(--az-muted-dark)]">
          Azemax Developer Environment • {BRAND.version}
        </div>

      </div>
    </footer>
  );
};
