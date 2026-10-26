import React, { useEffect } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { LEGAL } from '../Legal/legalMeta';

interface PublicShellProps {
    children: React.ReactNode;
    /** Visible breadcrumb label; omit on the home page. */
    breadcrumb?: string;
    /** Path used to mark the active nav item. */
    path?: string;
}

const PRODUCT_LINKS = [
    { href: '/features', label: 'Features' },
    { href: '/docs', label: 'Documentation' },
    { href: '/faq', label: 'FAQ' },
    { href: '/contact', label: 'Contact' },
] as const;

export function usePublicPageScroll(): void {
    useEffect(() => {
        const html = document.documentElement;
        html.classList.add('az-doc-active');
        return () => html.classList.remove('az-doc-active');
    }, []);
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
    return (
        <a
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50 ${
                active
                    ? 'bg-[var(--az-surface-3)] text-[var(--az-text)]'
                    : 'text-[var(--az-text-muted)] hover:bg-[var(--az-surface-2)] hover:text-[var(--az-text)]'
            }`}
        >
            {label}
        </a>
    );
}

export const PublicShell: React.FC<PublicShellProps> = ({ children, breadcrumb, path = '' }) => {
    return (
        <div className="min-h-screen w-full bg-[var(--az-bg)] text-[var(--az-text)]">
            <a
                href="#public-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--az-accent)] focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
            >
                Skip to content
            </a>

            <header className="sticky top-0 z-40 border-b border-[var(--az-border-subtle)] bg-[var(--az-bg)]/90 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
                    <a
                        href="/"
                        className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                    >
                        <img
                            src="/img/azemax-mark-64.png"
                            alt=""
                            width={24}
                            height={24}
                            className="h-6 w-6 object-contain"
                            decoding="async"
                        />
                        <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text)]">
                            Azemax
                        </span>
                        <span className="rounded-full border border-[var(--az-accent-border)] bg-[var(--az-accent-soft)] px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--az-accent-bright)]">
                            Beta
                        </span>
                    </a>

                    <nav
                        aria-label="Product pages"
                        className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto pb-1 sm:order-none sm:mx-0 sm:w-auto sm:overflow-visible sm:pb-0"
                    >
                        {PRODUCT_LINKS.map((link) => (
                            <NavLink
                                key={link.href}
                                href={link.href}
                                label={link.label}
                                active={path === link.href}
                            />
                        ))}
                    </nav>

                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <a
                            href="/login"
                            className="rounded-md px-2.5 py-2 text-[12.5px] font-medium text-[var(--az-text-muted)] transition-colors hover:text-[var(--az-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                        >
                            Sign in
                        </a>
                        <a
                            href="/app"
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[var(--az-text)] px-3 py-2 text-[12.5px] font-medium text-[#080F1C] transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--az-bg)]"
                        >
                            Open workspace
                            <ArrowRight size={13} aria-hidden="true" />
                        </a>
                    </div>
                </div>
            </header>

            <main id="public-main" className="mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
                {breadcrumb ? (
                    <nav aria-label="Breadcrumb" className="mb-6">
                        <ol className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--az-text-muted)]">
                            <li>
                                <a href="/" className="rounded transition-colors hover:text-[var(--az-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50">
                                    Home
                                </a>
                            </li>
                            <li aria-hidden="true" className="text-[var(--az-text-faint)]">
                                /
                            </li>
                            <li aria-current="page" className="text-[var(--az-text-secondary)]">
                                {breadcrumb}
                            </li>
                        </ol>
                    </nav>
                ) : null}
                {children}
            </main>

            <footer className="border-t border-[var(--az-border-subtle)] bg-[var(--az-bg-subtle)]">
                <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
                    <div>
                        <div className="flex items-center gap-2.5">
                            <img
                                src="/img/azemax-mark-64.png"
                                alt=""
                                width={22}
                                height={22}
                                className="h-[22px] w-[22px] object-contain"
                                loading="lazy"
                                decoding="async"
                            />
                            <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text)]">
                                Azemax Studio
                            </span>
                        </div>
                        <p className="mt-3 max-w-sm text-[12.5px] leading-relaxed text-[var(--az-text-muted)]">
                            A browser-based AI code editor and agentic development workspace.
                            Currently in public beta.
                        </p>
                        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--az-text-faint)]">
                            Azemax Studio is an independent developer project.
                        </p>
                    </div>

                    <nav aria-label="Footer product links" className="flex flex-col gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                            Product
                        </span>
                        {PRODUCT_LINKS.map((link) => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]"
                            >
                                {link.label}
                            </a>
                        ))}
                    </nav>

                    <nav aria-label="Footer legal links" className="flex flex-col gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                            Legal and contact
                        </span>
                        <a
                            href={LEGAL.supportEmail ? `mailto:${LEGAL.supportEmail}` : '/contact'}
                            className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]"
                        >
                            <Mail size={12} aria-hidden="true" />
                            Email support
                        </a>
                        <a
                            href="/privacy"
                            className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]"
                        >
                            Privacy Policy
                        </a>
                        <a
                            href="/terms"
                            className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]"
                        >
                            Terms of Service
                        </a>
                    </nav>
                </div>

                <div className="border-t border-[var(--az-border-subtle)]">
                    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-[11px] text-[var(--az-text-faint)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        <span>© {new Date().getFullYear()} Azemax Studio. All rights reserved.</span>
                        <span className="font-mono uppercase tracking-[0.12em]">
                            Public beta · v1.0.0-beta
                        </span>
                    </div>
                </div>
            </footer>
        </div>
    );
};
