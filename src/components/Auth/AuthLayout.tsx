import React, { useEffect } from 'react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BRAND } from '../../core/branding';
import { LEGAL_PATHS } from '../Legal/legalMeta';
import { Sparkles } from 'lucide-react';

interface AuthLayoutProps {
    children: React.ReactNode;
    /** Task-adapted brand-panel headline (desktop only). */
    headline: string;
    /** Task-adapted brand-panel supporting line (desktop only). */
    subheadline: string;
}

const TERMS_URL = LEGAL_PATHS.terms;
const PRIVACY_URL = LEGAL_PATHS.privacy;

/**
 * Azemax authentication shell.
 *
 * Layout: a fixed brand column on large screens (lg+) and a single, focused,
 * internally-scrolling form column. The shell fills the app viewport (#root is
 * 100dvh with the page body locked) and only the form column scrolls, so the
 * brand composition never drifts and no essential action is ever clipped.
 *
 * The brand column carries one accent badge, one headline, one restrained
 * editor preview, and a single-line footer. It contains no invented product
 * status: the preview is a static editor mock with honest editor chrome
 * (filename, language, encoding, caret position) — never a fabricated
 * "environment ready" indicator.
 */
export const AuthLayout: React.FC<AuthLayoutProps> = ({
    children,
    headline,
    subheadline,
}) => {
    // Prevent indexing of auth pages
    useEffect(() => {
        const head = document.head;
        let robots = head.querySelector('meta[name="robots"]');
        if (!robots) {
            robots = document.createElement('meta');
            robots.setAttribute('name', 'robots');
            head.appendChild(robots);
        }
        robots.setAttribute('content', 'noindex, nofollow');
        return () => {
            robots.setAttribute('content', 'index, follow');
        };
    }, []);

    return (
        <div className="az-auth flex h-full w-full bg-[var(--az-bg)] text-[var(--az-text)]">
            {/* ---------------------------------------------------- brand column */}
            <aside className="relative hidden h-full w-[45%] max-w-[680px] shrink-0 flex-col justify-between overflow-hidden border-r border-[var(--az-border-subtle)] p-10 xl:p-14 lg:flex">
                {/* Atmospheric grid + single soft light source */}
                <div
                    aria-hidden="true"
                    className="absolute inset-0 opacity-[0.14]"
                    style={{
                        backgroundImage:
                            'linear-gradient(to right, rgba(230,237,248,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(230,237,248,0.09) 1px, transparent 1px)',
                        backgroundSize: '34px 34px',
                        maskImage: 'radial-gradient(ellipse 80% 70% at 30% 20%, #000 30%, transparent 78%)',
                        WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 30% 20%, #000 30%, transparent 78%)',
                    }}
                />
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-24 top-10 h-[420px] w-[420px] rounded-full bg-[var(--az-accent)]/[0.07] blur-[130px]"
                />

                {/* Brand header */}
                <div className="relative z-10 flex items-center">
                    <a
                        href="/"
                        className="az-ring flex items-center gap-2.5 rounded-lg p-1"
                        aria-label={`${BRAND.name} Studio home`}
                    >
                        <AzemaxLogo size={26} />
                        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--az-text)]">
                            {BRAND.name} Studio
                        </span>
                        <span className="rounded-full border border-[var(--az-border)] bg-[var(--az-surface-2)] px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--az-text-muted)]">
                            Beta
                        </span>
                    </a>
                </div>

                {/* Headline + preview */}
                <div className="relative z-10 w-full max-w-[460px] py-6">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--az-border)] bg-[var(--az-surface-2)]/70 px-2.5 py-1 text-[11px] text-[var(--az-text-secondary)]">
                        <Sparkles size={12} className="text-[var(--az-accent)]" aria-hidden="true" />
                        <span>AI-native code editor</span>
                    </div>

                    <p className="text-[28px] font-semibold leading-[1.18] tracking-[-0.025em] text-[var(--az-text)] xl:text-[32px]">
                        {headline}
                    </p>
                    <p className="mt-3 max-w-[400px] text-[14px] leading-relaxed text-[var(--az-text-muted)]">
                        {subheadline}
                    </p>

                    <IdePreview />
                </div>

                {/* Footer */}
                <div className="relative z-10 flex items-center justify-between text-[11.5px] text-[var(--az-text-faint)]">
                    <span className="font-medium tracking-[0.02em] text-[var(--az-text-muted)]">
                        Build beyond limits.
                    </span>
                    <span>© {new Date().getFullYear()} {BRAND.name} Studio</span>
                </div>
            </aside>

            {/* ----------------------------------------------------- form column */}
            <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                {/* Mobile / tablet brand header */}
                <header className="flex items-center px-6 pt-6 sm:px-8 lg:hidden">
                    <a
                        href="/"
                        className="az-ring flex items-center gap-2 rounded-lg p-1"
                        aria-label={`${BRAND.name} Studio home`}
                    >
                        <AzemaxLogo size={24} />
                        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--az-text)]">
                            {BRAND.name} Studio
                        </span>
                    </a>
                </header>

                {/* Form — vertically centred when the viewport allows, never clipped */}
                <main className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-8 lg:px-12 lg:py-12">
                    <div className="mx-auto w-full max-w-[440px]">
                        {children}
                    </div>
                </main>

                {/* Footer */}
                <footer className="px-6 pb-6 sm:px-8 lg:px-12">
                    <div className="mx-auto flex w-full max-w-[440px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--az-border-subtle)] pt-4 text-[11.5px] text-[var(--az-text-faint)]">
                        <nav className="flex items-center gap-3" aria-label="Legal and home">
                            <a href="/" className="az-ring rounded transition-colors hover:text-[var(--az-text)]">
                                Home
                            </a>
                            <a
                                href={TERMS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="az-ring rounded transition-colors hover:text-[var(--az-text)]"
                            >
                                Terms
                            </a>
                            <a
                                href={PRIVACY_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="az-ring rounded transition-colors hover:text-[var(--az-text)]"
                            >
                                Privacy
                            </a>
                        </nav>
                        <span className="lg:hidden">© {new Date().getFullYear()} {BRAND.name} Studio</span>
                    </div>
                </footer>
            </div>
        </div>
    );
};

/**
 * Restrained, static editor preview. Real editor chrome only — no invented
 * runtime status. Syntax colors mirror the app's editor theme so the mock reads
 * as the same product, and nothing here animates (calm, not distracting).
 */
function IdePreview() {
    return (
        <div className="mt-8 overflow-hidden rounded-xl border border-[var(--az-border)] bg-[var(--az-surface)] shadow-[0_18px_44px_rgba(0,0,0,0.45)]">
            {/* Tab bar */}
            <div className="flex items-center gap-3 border-b border-[var(--az-border-subtle)] bg-[var(--az-surface-2)] px-3 py-2">
                <div className="flex items-center gap-[6px]" aria-hidden="true">
                    <span className="h-2 w-2 rounded-full bg-[var(--az-border-strong)]" />
                    <span className="h-2 w-2 rounded-full bg-[var(--az-border-strong)]" />
                    <span className="h-2 w-2 rounded-full bg-[var(--az-border-strong)]" />
                </div>
                <span className="font-mono text-[11px] text-[var(--az-text-secondary)]">workspace.ts</span>
            </div>

            {/* Code */}
            <div className="space-y-[3px] bg-[var(--az-editor-bg)] px-3 py-3 font-mono text-[11.5px] leading-[1.65]">
                <CodeLine n={1}>
                    <span className="text-[#5B8CFF]">const</span> <span className="text-[var(--az-text)]">studio</span> ={' '}
                    <span className="text-[#5B8CFF]">await</span> <span className="text-[#8FB0FF]">open</span>
                    <span className="text-[var(--az-text-muted)]">(</span>
                    <span className="text-[#67D6A0]">&apos;./workspace&apos;</span>
                    <span className="text-[var(--az-text-muted)]">);</span>
                </CodeLine>
                <CodeLine n={2}>
                    <span className="text-[#5B8CFF]">await</span> studio.<span className="text-[#8FB0FF]">run</span>
                    <span className="text-[var(--az-text-muted)]">(</span>
                    <span className="text-[#8FB0FF]">task</span>
                    <span className="text-[var(--az-text-muted)]">);</span>
                </CodeLine>
                <CodeLine n={3}>
                    studio.<span className="text-[#8FB0FF]">history</span>.<span className="text-[#8FB0FF]">push</span>
                    <span className="text-[var(--az-text-muted)]">(</span>
                    <span className="text-[var(--az-text)]">commit</span>
                    <span className="text-[var(--az-text-muted)]">);</span>
                </CodeLine>
                <CodeLine n={4} active>
                    <span className="text-[var(--az-text-disabled)]">// ship the next change</span>
                </CodeLine>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between border-t border-[var(--az-border-subtle)] bg-[var(--az-surface-input)] px-3 py-1.5 font-mono text-[10px] text-[var(--az-text-muted)]">
                <span className="flex items-center gap-3">
                    <span>main</span>
                    <span>TypeScript</span>
                </span>
                <span>UTF-8 · Ln 4, Col 1</span>
            </div>
        </div>
    );
}

function CodeLine({ n, active = false, children }: { n: number; active?: boolean; children: React.ReactNode }) {
    return (
        <div className={`flex gap-3 ${active ? 'rounded-[4px] bg-[var(--az-accent)]/[0.06]' : ''}`}>
            <span className="w-4 shrink-0 select-none text-right text-[var(--az-text-disabled)]">{n}</span>
            <span className="min-w-0 truncate">{children}</span>
        </div>
    );
}
