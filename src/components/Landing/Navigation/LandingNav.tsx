import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { BRAND } from '../../../core/branding';
import { ArrowRight, Menu, X } from 'lucide-react';

interface LandingNavProps {
  onEnterWorkspace: () => void;
}

const NAV_LINKS = [
  { label: 'Capabilities', href: '#philosophy' },
  { label: 'Experience', href: '#modes' },
  { label: 'Product', href: '#system' },
] as const;

const SCROLLED_THRESHOLD = 24;
const REVEAL_ZONE = 140;
const HIDE_ZONE = 420;
const DIRECTION_DEAD_ZONE = 4;

export const LandingNav: React.FC<LandingNavProps> = memo(({ onEnterWorkspace }) => {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [activeHref, setActiveHref] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const tickingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const lastYRef = useRef(0);
  const maxScrollRef = useRef(0);
  const scrolledRef = useRef(false);
  const hiddenRef = useRef(false);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const mobileOpenRef = useRef(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    mobileOpenRef.current = mobileMenuOpen;
  }, [mobileMenuOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
      if (e.matches && hiddenRef.current) {
        hiddenRef.current = false;
        setHidden(false);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Cache max scroll so we don't force layout on every scroll tick
  useEffect(() => {
    const updateMax = () => {
      maxScrollRef.current = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    };
    updateMax();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateMax);
      ro.observe(document.documentElement);
      ro.observe(document.body);
    }
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(updateMax, 120);
    };
    window.addEventListener('resize', onResize);
    // Font load or late images can change scrollHeight
    document.fonts?.ready.then(updateMax).catch(() => {});
    const late = window.setTimeout(updateMax, 800);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      window.clearTimeout(late);
    };
  }, []);

  // rAF scroll loop: imperative progress + guarded boolean commits
  useEffect(() => {
    const update = () => {
      tickingRef.current = false;
      rafIdRef.current = null;
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const max = maxScrollRef.current;

      const bar = progressRef.current;
      if (bar) {
        const ratio = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
        // Only touch DOM when ratio actually changed meaningfully
        const next = `scaleX(${ratio.toFixed(4)})`;
        if (bar.style.transform !== next) bar.style.transform = next;
      }

      const nextScrolled = y > SCROLLED_THRESHOLD;
      if (nextScrolled !== scrolledRef.current) {
        scrolledRef.current = nextScrolled;
        setScrolled(nextScrolled);
      }

      const dy = y - lastYRef.current;
      let nextHidden = hiddenRef.current;
      if (reducedMotionRef.current || mobileOpenRef.current || y < REVEAL_ZONE) {
        nextHidden = false;
      } else if (dy > DIRECTION_DEAD_ZONE && y > HIDE_ZONE) {
        nextHidden = true;
      } else if (dy < -DIRECTION_DEAD_ZONE) {
        nextHidden = false;
      }
      if (nextHidden !== hiddenRef.current) {
        hiddenRef.current = nextHidden;
        setHidden(nextHidden);
      }
      lastYRef.current = y;
    };

    const schedule = () => {
      if (!tickingRef.current) {
        tickingRef.current = true;
        rafIdRef.current = requestAnimationFrame(update);
      }
    };

    // Sync initial state without extra render if already at top
    const initialY = window.scrollY || document.documentElement.scrollTop || 0;
    lastYRef.current = initialY;
    update();

    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('scroll', schedule);
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Scroll-spy
  useEffect(() => {
    const ids = NAV_LINKS.map((l) => l.href.slice(1));
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const next = `#${entry.target.id}`;
            setActiveHref((prev) => (prev === next ? prev : next));
          }
        }
      },
      { rootMargin: '-38% 0px -55% 0px', threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Mobile menu: Esc, close on desktop, body lock with scrollbar compensation
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarW = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = 'hidden';
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [mobileMenuOpen]);

  const handleEnterWorkspace = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setMobileMenuOpen(false);
      onEnterWorkspace();
    },
    [onEnterWorkspace]
  );

  const handleBrandClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    // Respect reduced motion; also strip hash so refresh doesn't re-jump
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    window.scrollTo({
      top: 0,
      behavior: reducedMotionRef.current ? 'auto' : 'smooth',
    });
  }, []);

  const handleToggleMenu = useCallback(() => setMobileMenuOpen((v) => !v), []);
  const handleCloseMenu = useCallback(() => setMobileMenuOpen(false), []);

  // useMemo keeps desktop/mobile link lists referentially stable so the nav
  // doesn't reconcile 6 anchors on every scroll-driven render (scrolled /
  // progress ticks). Active state is derived per render, not stored.
  const desktopLinks = useMemo(
    () =>
      NAV_LINKS.map((link) => ({
        ...link,
        isActive: activeHref === link.href,
      })),
    [activeHref],
  );
  const mobileLinks = useMemo(
    () =>
      NAV_LINKS.map((link) => ({
        ...link,
        isActive: activeHref === link.href,
      })),
    [activeHref],
  );

  return (
    <header
      className={`az-nav-shell fixed inset-x-0 top-0 z-50 ${hidden && !mobileMenuOpen ? '-translate-y-full motion-reduce:translate-y-0' : 'translate-y-0'}`}
      // Isolate backdrop-filter repaint; only transform/opacity animate (composited)
      style={{ contain: 'layout paint' } as React.CSSProperties}
    >
      {/* Backdrop — low-cost: 10px blur only, no saturate, no large shadow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 ${scrolled || mobileMenuOpen ? 'opacity-100' : 'opacity-0'}`}
        style={{ transition: 'opacity 220ms ease' }}
      >
        <div className="absolute inset-0 bg-[#04060c]/75 backdrop-blur-[10px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4F8CFF]/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-white/[0.06]" />
      </div>
      {/* Readability scrim at top — no blur */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/10 to-transparent ${scrolled || mobileMenuOpen ? 'opacity-0' : 'opacity-100'}`}
        style={{ transition: 'opacity 220ms ease' }}
      />

      {/* Scroll progress — scaleX only, no shadow while scrolling for lower GPU cost */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
        <div
          ref={progressRef}
          className="h-full w-full origin-left bg-[#4F8CFF]"
          style={{ transform: 'scaleX(0)', willChange: 'transform' } as React.CSSProperties}
        />
      </div>

      {/* Fixed height = no layout reflow on scrolled toggle */}
      <div className="relative mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 md:px-12">
        <a
          href="#top"
          onClick={handleBrandClick}
          className="group flex min-w-0 select-none items-center gap-2 sm:gap-2.5 rounded-lg px-1.5 py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF]/70"
          aria-label="Azemax — back to top"
        >
          <span className="relative grid h-6 w-6 place-items-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-md bg-[#4F8CFF]/20 blur-[6px] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            />
            <img
              src={BRAND.logoSrc}
              alt=""
              width={20}
              height={20}
              decoding="async"
              className="relative h-5 w-5 shrink-0 object-contain opacity-90 transition-[opacity,filter] duration-200 group-hover:opacity-100 group-hover:brightness-110"
              draggable={false}
            />
          </span>
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-white/90 transition-colors duration-200 group-hover:text-white">
            {BRAND.name}
          </span>
          <span className="rounded-full border border-[#4F8CFF]/40 bg-[#4F8CFF]/10 px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#8FB4FF]">
            Beta
          </span>
        </a>

        <nav
          className="hidden items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-1 md:flex"
          aria-label="Main Navigation"
        >
          {desktopLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.isActive ? 'location' : undefined}
              className={`relative rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF]/70 ${
                link.isActive ? 'text-white' : 'text-white/55 hover:text-white/90'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-full border bg-[#4F8CFF]/[0.12] transition-opacity duration-200 ease-out ${
                  link.isActive ? 'border-[#4F8CFF]/35 opacity-100' : 'border-transparent opacity-0'
                }`}
              />
              <span className="relative flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1 w-1 rounded-full bg-[#8FB4FF] transition-[opacity,transform] duration-200 ease-out ${
                    link.isActive ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                  }`}
                />
                {link.label}
              </span>
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href="/app"
            onClick={handleEnterWorkspace}
            className={`group flex items-center gap-2 rounded-full font-sans text-[13px] font-medium tracking-tight transition-[background-color,border-color,color,transform,opacity] duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF]/70 ${
              scrolled
                ? 'border border-white/90 bg-white px-4 py-2 text-black hover:opacity-95 active:opacity-90'
                : 'border border-white/10 bg-white/[0.06] px-4 py-2 text-white/85 hover:border-white/15 hover:bg-white/[0.09] hover:text-white'
            }`}
          >
            <span>Enter workspace</span>
            <ArrowRight
              size={14}
              className={`transition-transform duration-200 group-hover:translate-x-0.5 ${scrolled ? 'text-black/60' : 'text-[#8FB4FF]'}`}
            />
          </a>
        </div>

        <button
          type="button"
          onClick={handleToggleMenu}
          aria-label={mobileMenuOpen ? 'Close Menu' : 'Open Menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="landing-mobile-menu"
          className={`grid h-9 w-9 place-items-center rounded-lg border transition-colors duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#4F8CFF]/70 md:hidden ${
            mobileMenuOpen ? 'border-[#4F8CFF]/40 bg-[#4F8CFF]/10 text-white' : 'border-white/10 bg-white/[0.04] text-white/80 hover:text-white'
          }`}
        >
          {mobileMenuOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
      </div>

      <div
        id="landing-mobile-menu"
        aria-hidden={!mobileMenuOpen}
        className={`absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto px-4 pb-4 motion-reduce:transition-none md:hidden ${mobileMenuOpen ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'}`}
        style={{ transition: 'opacity 200ms ease, transform 200ms ease' }}
      >
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#05080f]/95 shadow-[0_24px_64px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-[#4F8CFF]/50 to-transparent" />
          <nav className="flex flex-col p-2" aria-label="Mobile Navigation">
            {mobileLinks.map((link, i) => (
              <a
                key={link.href}
                href={link.href}
                tabIndex={mobileMenuOpen ? 0 : -1}
                onClick={handleCloseMenu}
                style={{ transitionDelay: mobileMenuOpen ? `${i * 40}ms` : '0ms' }}
                className={`flex items-center justify-between rounded-xl px-4 py-3.5 font-mono text-xs uppercase tracking-[0.16em] transition-[opacity,transform,background-color,color] duration-200 motion-reduce:transition-none ${
                  mobileMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                } ${link.isActive ? 'bg-[#4F8CFF]/10 text-white' : 'text-white/60 hover:bg-white/[0.05] hover:text-white'}`}
              >
                <span>{link.label}</span>
                <span aria-hidden="true" className={link.isActive ? 'text-[#8FB4FF]' : 'text-white/25'}>
                  →
                </span>
              </a>
            ))}
          </nav>
          <div className="border-t border-white/[0.07] p-3">
            <a
              href="/app"
              onClick={handleEnterWorkspace}
              tabIndex={mobileMenuOpen ? 0 : -1}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[13px] font-medium text-black transition-colors duration-200 hover:bg-slate-100"
            >
              <span>Enter workspace</span>
              <ArrowRight size={14} className="text-black/60" />
            </a>
            <p className="pt-2.5 text-center font-mono text-[10px] tracking-[0.14em] text-white/30">
              ZERO SETUP • PRIVATE BY DEFAULT
            </p>
          </div>
        </div>
      </div>
    </header>
  );
});

LandingNav.displayName = 'LandingNav';
