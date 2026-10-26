import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { CardLink } from './Article';

/**
 * Rendered for unknown paths. The host serves this document with a real 404
 * status (see vercel.json) and the head carries noindex, so a missing URL is
 * never mistaken for a valid page.
 */
export const NotFoundPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell breadcrumb="Page not found">
            <div className="py-6 sm:py-10">
                <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--az-accent)]">
                    Error 404
                </p>
                <h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--az-text)] sm:text-[46px]">
                    This page does not exist.
                </h1>
                <p className="mt-4 max-w-2xl text-[15.5px] leading-[1.75] text-[var(--az-text-secondary)]">
                    The address may be mistyped, or the page may have moved. Nothing was deleted from
                    your account by visiting this URL.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                    <a
                        href="/"
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[var(--az-text)] px-4 py-2.5 text-[13px] font-medium text-[#080F1C] transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--az-bg)]"
                    >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Back to home
                    </a>
                    <a
                        href="/docs"
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-[var(--az-border)] bg-[var(--az-surface-2)] px-4 py-2.5 text-[13px] font-medium text-[var(--az-text-secondary)] transition-colors hover:border-[var(--az-accent-border)] hover:text-[var(--az-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                    >
                        Read the documentation
                        <ArrowRight size={14} aria-hidden="true" />
                    </a>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CardLink href="/features" title="Features">
                        What the editor and agent actually do.
                    </CardLink>
                    <CardLink href="/docs" title="Documentation">
                        Setup and troubleshooting.
                    </CardLink>
                    <CardLink href="/faq" title="FAQ">
                        Short product answers.
                    </CardLink>
                    <CardLink href="/contact" title="Contact">
                        Support and privacy requests.
                    </CardLink>
                </div>
            </div>
        </PublicShell>
    );
};
