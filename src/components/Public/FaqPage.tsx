import React from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { PageHero, CardLink, TextLink } from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { FAQ_ITEMS } from '../../content/faqs';

export const FaqPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/faq" breadcrumb="FAQ">
            <PageHero
                eyebrow="Frequently asked questions"
                title={
                    <>
                        Straight answers about
                        <span className="block text-[var(--az-accent)]">accounts, keys, and code.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            These answers describe the hosted public beta as it actually works today. If a
                            question is not covered here, check the{' '}
                            <TextLink href="/docs">documentation</TextLink> or{' '}
                            <TextLink href="/contact">contact support</TextLink>.
                        </p>
                    </>
                }
                meta="Last reviewed 26 October 2026"
            />

            <div className="mt-10 divide-y divide-[var(--az-border-subtle)] rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)]">
                {FAQ_ITEMS.map((item, index) => (
                    <details
                        key={item.id}
                        id={item.id}
                        className="group scroll-mt-24 px-5 py-4 sm:px-6 sm:py-5"
                        open={index === 0}
                    >
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50 [&::-webkit-details-marker]:hidden">
                            <h2 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-[var(--az-text)] sm:text-[17px]">
                                {item.question}
                            </h2>
                            <span
                                aria-hidden="true"
                                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--az-border)] bg-[var(--az-surface-2)] text-[var(--az-text-muted)] transition-transform duration-200 group-open:rotate-180"
                            >
                                <ChevronDown size={14} />
                            </span>
                        </summary>
                        <p className="mt-3 max-w-3xl text-[14.5px] leading-[1.75] text-[var(--az-text-secondary)]">
                            {item.answer}
                        </p>
                    </details>
                ))}
            </div>

            <div className="mt-10 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5">
                <p className="text-[14px] font-semibold text-[var(--az-text)]">
                    Looking for setup steps?
                </p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--az-text-muted)]">
                    The documentation covers account creation, the workspace layout, assistant modes,
                    provider configuration, execution limits, and troubleshooting in more detail.
                </p>
                <a
                    href="/docs"
                    className="mt-4 inline-flex min-h-[38px] items-center gap-2 rounded-md border border-[var(--az-border)] bg-[var(--az-surface-2)] px-3.5 py-2 text-[13px] font-medium text-[var(--az-text-secondary)] transition-colors hover:border-[var(--az-accent-border)] hover:text-[var(--az-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                >
                    Read the documentation
                    <ArrowRight size={13} aria-hidden="true" />
                </a>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <CardLink href="/features" title="Product features">
                    The editor, assistant, providers, execution, and account behavior.
                </CardLink>
                <CardLink href="/privacy" title="Privacy Policy">
                    Data categories, providers, retention, and deletion requests.
                </CardLink>
                <CardLink href="/terms" title="Terms of Service">
                    Acceptable use, AI output limits, and execution risk.
                </CardLink>
            </div>
        </PublicShell>
    );
};
