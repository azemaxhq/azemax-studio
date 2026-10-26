import React, { memo } from 'react';
import { BRAND } from '../../../core/branding';
import { LEGAL, LEGAL_PATHS } from '../../Legal/legalMeta';

interface LandingFooterProps {
  onEnterWorkspace: () => void;
}

export const LandingFooter: React.FC<LandingFooterProps> = memo(({ onEnterWorkspace }) => {
  return (
    <footer className="py-10 sm:py-16 px-4 sm:px-6 md:px-12 lg:px-16 bg-[#000204] border-t border-[rgba(255,255,255,0.06)] relative z-20 text-xs text-[var(--az-muted)] font-mono">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 sm:gap-8 text-center md:text-left">
        
        {/* Brand & Tagline */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <img
              src={BRAND.logoSrc}
              alt={BRAND.name}
              width={20}
              height={20}
              decoding="async"
              className="w-5 h-5 object-contain shrink-0"
              style={{ width: '20px', height: '20px', maxWidth: '20px', maxHeight: '20px' }}
            />
            <span className="font-semibold text-white tracking-widest uppercase">
              {BRAND.name}
            </span>
            <span className="rounded-full border border-[#4F8CFF]/40 bg-[#4F8CFF]/10 px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#8FB4FF]">
              Beta
            </span>
          </div>
          <span className="hidden sm:inline text-white/20">|</span>
          <span className="font-sans text-[var(--az-muted)]">
            Build beyond limits.
          </span>
        </div>

        {/* Minimal Navigation */}
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
        >
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
          <a href="/features" className="hover:text-white transition-colors">
            Features
          </a>
          <a href="/docs" className="hover:text-white transition-colors">
            Docs
          </a>
          <a href="/faq" className="hover:text-white transition-colors">
            FAQ
          </a>
          <a href={LEGAL_PATHS.privacy} className="hover:text-white transition-colors">
            Privacy
          </a>
          <a href={LEGAL_PATHS.terms} className="hover:text-white transition-colors">
            Terms
          </a>
          <a
            href="/contact"
            className="hover:text-white transition-colors"
          >
            Contact
          </a>
        </nav>

        {/* Technical Stamp */}
        <div className="flex flex-col items-center gap-1 text-[11px] text-[var(--az-muted-dark)] md:items-end">
          <span>Azemax Developer Environment • {BRAND.version}</span>
          <span>© {new Date().getFullYear()} {LEGAL.operator}</span>
        </div>

      </div>
    </footer>
  );
});

LandingFooter.displayName = 'LandingFooter';
