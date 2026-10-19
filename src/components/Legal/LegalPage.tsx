import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { AzemaxLogo } from '../UI/AzemaxLogo';
import { navigate } from '../../utils/appRouter';
import {
    LEGAL,
    LEGAL_PATHS,
    LEGAL_ABSOLUTE,
    type LegalBlock,
    type LegalBullet,
    type LegalDocument,
    type LegalSection,
} from './legalMeta';
import { legalDocumentForPath } from './legalContent';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Inline markup renderer
 * Supports **bold**, `code`, and [label](href). Internal hrefs (starting
 * with "/") navigate without a full reload through the app router.
 * ------------------------------------------------------------------ */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`)/g;

function SmartLink({ href, children }: { href: string; children: React.ReactNode }) {
    const isInternal = href.startsWith('/');
    if (isInternal) {
        return (
            <a
                href={href}
                onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    navigate(href);
                }}
                className="az-ring rounded font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] hover:decoration-[var(--az-accent-hover)]/60"
            >
                {children}
            </a>
        );
    }
    const isMail = href.startsWith('mailto:') || href.startsWith('tel:');
    return (
        <a
            href={href}
            {...(isMail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            className="az-ring rounded font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] hover:decoration-[var(--az-accent-hover)]/60"
        >
            {children}
        </a>
    );
}

function InlineText({ text }: { text: string }) {
    const nodes = useMemo(() => {
        const out: React.ReactNode[] = [];
        const re = new RegExp(INLINE_PATTERN.source, 'g');
        let last = 0;
        let key = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            if (match.index > last) out.push(text.slice(last, match.index));
            const token = match[0];
            if (token.startsWith('**') && token.endsWith('**')) {
                out.push(
                    <strong key={key++} className="font-semibold text-[var(--az-text)]">
                        {token.slice(2, -2)}
                    </strong>,
                );
            } else if (token.startsWith('`') && token.endsWith('`')) {
                out.push(
                    <code
                        key={key++}
                        className="rounded border border-[var(--az-border-subtle)] bg-[var(--az-surface-input)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--az-text-secondary)]"
                    >
                        {token.slice(1, -1)}
                    </code>,
                );
            } else {
                const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
                if (link) {
                    out.push(
                        <SmartLink key={key++} href={link[2]}>
                            {link[1]}
                        </SmartLink>,
                    );
                } else {
                    out.push(token);
                }
            }
            last = match.index + token.length;
        }
        if (last < text.length) out.push(text.slice(last));
        return out;
    }, [text]);

    return <>{nodes}</>;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

function Block({ block }: { block: LegalBlock }) {
    if (block.kind === 'p') {
        return (
            <p className="text-[15px] leading-[1.75] text-[var(--az-text-secondary)]">
                <InlineText text={block.text} />
            </p>
        );
    }

    if (block.kind === 'list') {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
            <Tag className="list-none space-y-2.5 pl-0">
                {block.items.map((item, index) => {
                    const bullet: LegalBullet = typeof item === 'string' ? { text: item } : item;
                    return (
                        <li key={index} className="flex gap-3 text-[15px] leading-[1.75] text-[var(--az-text-secondary)]">
                            {block.ordered ? (
                                <span className="mt-[2px] w-4 shrink-0 text-right font-mono text-[13px] text-[var(--az-text-faint)]">
                                    {typeof item === 'string' ? `${index + 1}.` : null}
                                </span>
                            ) : (
                                <span
                                    aria-hidden="true"
                                    className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--az-accent)]/60"
                                />
                            )}
                            <span className="min-w-0">
                                {bullet.term ? (
                                    <strong className="font-semibold text-[var(--az-text)]">{bullet.term}: </strong>
                                ) : null}
                                <InlineText text={bullet.text} />
                            </span>
                        </li>
                    );
                })}
            </Tag>
        );
    }

    // note / callout
    const warn = block.tone === 'warn';
    return (
        <div
            className={`rounded-[var(--az-radius-md)] border-l-2 px-4 py-3.5 ${
                warn
                    ? 'border-[var(--az-warning)] bg-[var(--az-warning-soft)]'
                    : 'border-[var(--az-accent)] bg-[var(--az-accent-soft-subtle)]'
            }`}
        >
            <p className="text-[13.5px] leading-[1.7] text-[var(--az-text-secondary)]">
                <InlineText text={block.text} />
            </p>
        </div>
    );
}

function Section({ section }: { section: LegalSection }) {
    return (
        <section id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
            <h2
                id={`${section.id}-heading`}
                className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--az-text)] sm:text-[21px]"
            >
                {section.title}
            </h2>
            <div className="mt-4 space-y-4">
                {section.blocks.map((block, index) => (
                    <Block key={index} block={block} />
                ))}
            </div>
        </section>
    );
}

/* ------------------------------------------------------------------ *
 * Chrome: header, table of contents, footer
 * ------------------------------------------------------------------ */

const OTHER_DOC_LABEL: Record<LegalDocument['kind'], string> = {
    privacy: 'Terms of Service',
    terms: 'Privacy Policy',
};

function LegalHeader({ doc }: { doc: LegalDocument }) {
    const otherKind = doc.kind === 'privacy' ? 'terms' : 'privacy';
    return (
        <header className="sticky top-0 z-30 border-b border-[var(--az-border-subtle)] bg-[var(--az-bg)]/85 backdrop-blur-md">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <a
                    href="/"
                    onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        navigate('/');
                    }}
                    className="az-ring flex items-center gap-2.5 rounded-lg px-1 py-1"
                    aria-label={`${LEGAL.product} home`}
                >
                    <AzemaxLogo size={22} />
                    <span className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-[var(--az-text)]">
                        {LEGAL.operator}
                    </span>
                    <span className="hidden rounded-full border border-[var(--az-border)] bg-[var(--az-surface-2)] px-2 py-[2px] text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--az-text-muted)] sm:inline">
                        Beta
                    </span>
                </a>

                <nav className="flex items-center gap-1.5" aria-label="Legal documents">
                    <a
                        href={LEGAL_PATHS[otherKind]}
                        onClick={(e) => {
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                            e.preventDefault();
                            navigate(LEGAL_PATHS[otherKind]);
                        }}
                        className="az-ring hidden rounded-md px-3 py-1.5 text-[12.5px] font-medium text-[var(--az-text-secondary)] transition-colors hover:bg-[var(--az-surface-2)] hover:text-[var(--az-text)] sm:inline-flex"
                    >
                        {OTHER_DOC_LABEL[doc.kind]}
                    </a>
                    <a
                        href={`mailto:${LEGAL.supportEmail}`}
                        className="az-ring inline-flex items-center gap-1.5 rounded-md border border-[var(--az-border)] bg-[var(--az-surface-2)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--az-text-secondary)] transition-colors hover:border-[var(--az-accent-border)] hover:text-[var(--az-text)]"
                    >
                        <Mail size={13} aria-hidden="true" />
                        Contact
                    </a>
                </nav>
            </div>
        </header>
    );
}

function TableOfContents({ sections, title }: { sections: LegalSection[]; title: string }) {
    return (
        <nav
            aria-label={`Contents of the ${title}`}
            className="rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:p-6"
        >
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                <ShieldCheck size={13} className="text-[var(--az-accent)]" aria-hidden="true" />
                Contents
            </p>
            <ol className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                {sections.map((section) => (
                    <li key={section.id}>
                        <a
                            href={`#${section.id}`}
                            className="az-ring block rounded py-0.5 text-[13px] leading-snug text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-accent-hover)]"
                        >
                            {section.title}
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

function LegalFooter({ doc }: { doc: LegalDocument }) {
    const otherKind = doc.kind === 'privacy' ? 'terms' : 'privacy';
    return (
        <footer className="mt-16 border-t border-[var(--az-border-subtle)] bg-[var(--az-bg-subtle)]">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <AzemaxLogo size={20} />
                        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--az-text)]">
                            {LEGAL.operator}
                        </span>
                    </div>
                    <p className="max-w-xs text-[12.5px] leading-relaxed text-[var(--az-text-muted)]">
                        Fast, intelligent developer environment.
                    </p>
                    <p className="text-[11.5px] text-[var(--az-text-faint)]">
                        © {new Date().getFullYear()} {LEGAL.operator}. All rights reserved.
                    </p>
                </div>

                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                        Legal
                    </span>
                    <a href={LEGAL_PATHS.privacy} className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]">
                        Privacy Policy
                    </a>
                    <a href={LEGAL_PATHS.terms} className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]">
                        Terms of Service
                    </a>
                    <a href={LEGAL_PATHS[otherKind]} className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]">
                        Switch to {OTHER_DOC_LABEL[doc.kind]}
                    </a>
                </div>

                <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                        Contact
                    </span>
                    <a
                        href={`mailto:${LEGAL.supportEmail}`}
                        className="w-fit text-[12.5px] text-[var(--az-text-secondary)] transition-colors hover:text-[var(--az-text)]"
                    >
                        {LEGAL.supportEmail}
                    </a>
                    <span className="text-[12.5px] text-[var(--az-text-muted)]">Support & legal notices</span>
                </div>
            </div>
        </footer>
    );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

/**
 * Public legal document page. Rendered for `/privacy` and `/terms` OUTSIDE the
 * AuthProvider and AuthGate, so it is reachable by anyone (including signed-out
 * visitors and automated reviewers) and works on direct navigation or refresh.
 */
export const LegalPage: React.FC<{ path: string }> = ({ path }) => {
    const doc = useMemo(() => legalDocumentForPath(path) ?? null, [path]);
    const isPrivacy = path === '/privacy';
    const canonicalUrl = isPrivacy ? LEGAL_ABSOLUTE.privacy : LEGAL_ABSOLUTE.terms;
    const ogTitle = isPrivacy ? 'Privacy Policy — Azemax Studio' : 'Terms of Service — Azemax Studio';
    const ogDescription = isPrivacy
        ? 'How Azemax Studio collects, uses, and protects your data. Transparent privacy practices for developers.'
        : 'Terms of Service for Azemax Studio. Your rights and responsibilities when using the AI-powered code editor.';

    // The IDE shell locks page scroll (body overflow:hidden, #root 100dvh).
    // Legal pages are long documents, so opt into normal document scrolling
    // while mounted and restore the shell on unmount.
    useLayoutEffect(() => {
        const html = document.documentElement;
        html.classList.add('az-doc-active');
        return () => html.classList.remove('az-doc-active');
    }, []);

    // Inject SEO metadata for legal pages
    useLayoutEffect(() => {
        if (!doc) return;
        const head = document.head;
        // Canonical link
        let canonical = head.querySelector('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.setAttribute('rel', 'canonical');
            head.appendChild(canonical);
        }
        canonical.setAttribute('href', canonicalUrl);
        // Meta description
        let metaDesc = head.querySelector('meta[name="description"]');
        if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.setAttribute('name', 'description');
            head.appendChild(metaDesc);
        }
        metaDesc.setAttribute('content', doc.intro);
        // Robots: index, follow (legal pages are public and should be discoverable)
        let robots = head.querySelector('meta[name="robots"]');
        if (!robots) {
            robots = document.createElement('meta');
            robots.setAttribute('name', 'robots');
            head.appendChild(robots);
        }
        robots.setAttribute('content', 'index, follow');
        // Open Graph
        let ogTitleEl = head.querySelector('meta[property="og:title"]');
        if (!ogTitleEl) {
            ogTitleEl = document.createElement('meta');
            ogTitleEl.setAttribute('property', 'og:title');
            head.appendChild(ogTitleEl);
        }
        ogTitleEl.setAttribute('content', ogTitle);
        let ogDescEl = head.querySelector('meta[property="og:description"]');
        if (!ogDescEl) {
            ogDescEl = document.createElement('meta');
            ogDescEl.setAttribute('property', 'og:description');
            head.appendChild(ogDescEl);
        }
        ogDescEl.setAttribute('content', ogDescription);
        let ogUrlEl = head.querySelector('meta[property="og:url"]');
        if (!ogUrlEl) {
            ogUrlEl = document.createElement('meta');
            ogUrlEl.setAttribute('property', 'og:url');
            head.appendChild(ogUrlEl);
        }
        ogUrlEl.setAttribute('content', canonicalUrl);
        let ogTypeEl = head.querySelector('meta[property="og:type"]');
        if (!ogTypeEl) {
            ogTypeEl = document.createElement('meta');
            ogTypeEl.setAttribute('property', 'og:type');
            head.appendChild(ogTypeEl);
        }
        ogTypeEl.setAttribute('content', 'article');
        // Twitter
        let twitterCard = head.querySelector('meta[name="twitter:card"]');
        if (!twitterCard) {
            twitterCard = document.createElement('meta');
            twitterCard.setAttribute('name', 'twitter:card');
            head.appendChild(twitterCard);
        }
        twitterCard.setAttribute('content', 'summary');
        let twitterTitle = head.querySelector('meta[name="twitter:title"]');
        if (!twitterTitle) {
            twitterTitle = document.createElement('meta');
            twitterTitle.setAttribute('name', 'twitter:title');
            head.appendChild(twitterTitle);
        }
        twitterTitle.setAttribute('content', ogTitle);
        let twitterDesc = head.querySelector('meta[name="twitter:description"]');
        if (!twitterDesc) {
            twitterDesc = document.createElement('meta');
            twitterDesc.setAttribute('name', 'twitter:description');
            head.appendChild(twitterDesc);
        }
        twitterDesc.setAttribute('content', ogDescription);

        return () => {
            // Cleanup: restore original meta tags if needed
            // We don't remove them to avoid flicker; index.html defaults apply on unmount
        };
    }, [doc, path, canonicalUrl, ogTitle, ogDescription]);

    useEffect(() => {
        if (!doc) return;
        const previousTitle = document.title;
        document.title = `${doc.title} — ${LEGAL.operator}`;
        // Land on the hero on direct navigation, but respect an explicit anchor.
        if (!window.location.hash) window.scrollTo(0, 0);
        return () => {
            document.title = previousTitle;
        };
    }, [doc]);

    if (!doc) return null;

    return (
        <div className="az-legal-root min-h-screen w-full bg-[var(--az-bg)] text-[var(--az-text)]">
            <a
                href="#legal-main"
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--az-accent)] focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-white"
            >
                Skip to content
            </a>

            <LegalHeader doc={doc} />

            <main id="legal-main" className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
                {/* Document hero */}
                <div className="border-b border-[var(--az-border-subtle)] pb-8">
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--az-accent)]">
                        <ShieldCheck size={13} aria-hidden="true" />
                        {doc.eyebrow} · {LEGAL.operator}
                    </p>
                    <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-[var(--az-text)] sm:text-[40px]">
                        {doc.title}
                    </h1>
                    <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-[var(--az-text-muted)]">{doc.intro}</p>

                    <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
                        <div className="flex items-center gap-2">
                            <dt className="text-[var(--az-text-muted)]">Effective date</dt>
                            <dd className="font-medium text-[var(--az-text-secondary)]">{doc.effectiveDate}</dd>
                        </div>
                        <div className="flex items-center gap-2">
                            <dt className="text-[var(--az-text-muted)]">Last updated</dt>
                            <dd className="font-medium text-[var(--az-text-secondary)]">{doc.lastUpdated}</dd>
                        </div>
                        <div className="flex items-center gap-2">
                            <dt className="text-[var(--az-text-muted)]">Version</dt>
                            <dd className="font-medium text-[var(--az-text-secondary)]">{doc.version}</dd>
                        </div>
                    </dl>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <a
                            href="/"
                            onClick={(e) => {
                                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                                e.preventDefault();
                                navigate('/');
                            }}
                            className="az-ring inline-flex items-center gap-2 rounded-md border border-[var(--az-border)] bg-[var(--az-surface-2)] px-3.5 py-2 text-[13px] font-medium text-[var(--az-text-secondary)] transition-colors hover:border-[var(--az-accent-border)] hover:text-[var(--az-text)]"
                        >
                            <ArrowLeft size={14} aria-hidden="true" />
                            Back to home
                        </a>
                        <a
                            href={`mailto:${LEGAL.supportEmail}`}
                            className="az-ring inline-flex items-center gap-2 rounded-md px-1 py-2 text-[13px] font-medium text-[var(--az-accent)] transition-colors hover:text-[var(--az-accent-hover)]"
                        >
                            <Mail size={14} aria-hidden="true" />
                            {LEGAL.supportEmail}
                        </a>
                    </div>
                </div>

                {/* Contents */}
                <div className="pt-8">
                    <TableOfContents sections={doc.sections} title={doc.title} />
                </div>

                {/* Sections */}
                <article className="mt-12 space-y-10">
                    {doc.sections.map((section) => (
                        <Section key={section.id} section={section} />
                    ))}
                </article>

                <div className="mt-14 rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)] p-6">
                    <p className="text-[13.5px] leading-relaxed text-[var(--az-text-muted)]">
                        This document describes how {LEGAL.operator} actually operates. It is provided for
                        transparency and is not legal advice. Questions or requests? Email{' '}
                        <a
                            href={`mailto:${LEGAL.supportEmail}`}
                            className="az-ring rounded font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 hover:text-[var(--az-accent-hover)]"
                        >
                            {LEGAL.supportEmail}
                        </a>
                        .
                    </p>
                </div>
            </main>

            <LegalFooter doc={doc} />
        </div>
    );
};
