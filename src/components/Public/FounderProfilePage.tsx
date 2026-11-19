import React from 'react';
import {
    ArticleSection,
    Callout,
    CardLink,
    H3,
    PageHero,
    TextLink,
} from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { PersonAvatar } from './PersonAvatar';
import { LEADERSHIP } from '../../content/leadership';
import { SITE } from '../../seo/site';

export const FounderProfilePage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell
            path={LEADERSHIP.profilePath}
            breadcrumb={LEADERSHIP.name}
            breadcrumbParent={{ label: 'Leadership', href: '/leadership' }}
        >
            <PageHero
                eyebrow="Official profile · Founder and CEO"
                title={
                    <>
                        {LEADERSHIP.name}
                        <span className="block text-[var(--az-accent)]">
                            Founder and CEO of Azemax.
                        </span>
                    </>
                }
                intro={
                    <>
                        <p>{LEADERSHIP.summary}</p>
                        <p>
                            This is the official profile maintained by Azemax. It records his role
                            and responsibilities, not a personal résumé, and it links only to
                            profiles that Azemax has verified.
                        </p>
                    </>
                }
                meta="Last reviewed 19 November 2026"
            />

            <div className="mt-8 flex flex-col gap-5 rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:flex-row sm:items-center sm:p-6">
                <PersonAvatar
                    name={LEADERSHIP.name}
                    initials={LEADERSHIP.initials}
                    photo={LEADERSHIP.photo}
                    photoSrcSet={LEADERSHIP.photoSrcSet}
                    photoAlt={LEADERSHIP.photoAlt}
                    size={160}
                />
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                        Role
                    </p>
                    <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[var(--az-text)]">
                        {LEADERSHIP.roleLabel}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--az-text-secondary)]">
                        Organization: <TextLink href="/about">Azemax</TextLink>
                        <span aria-hidden="true" className="px-1.5 text-[var(--az-text-faint)]">
                            ·
                        </span>
                        Product:{' '}
                        <TextLink href="/">Azemax Studio</TextLink>
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--az-text-muted)]">
                        Canonical profile:{' '}
                        <span className="break-all font-mono">{LEADERSHIP.profileUrl}</span>
                    </p>
                </div>
            </div>

            <div className="mt-12 space-y-12">
                <ArticleSection id="biography" title="Professional biography">
                    {LEADERSHIP.bio.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                    ))}
                </ArticleSection>

                <ArticleSection id="responsibilities" title="Role and responsibilities">
                    <p>
                        As founder and CEO, {LEADERSHIP.name} is responsible for the following
                        areas:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        {LEADERSHIP.responsibilities.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                    <H3>What this page does not claim</H3>
                    <p>
                        This profile does not publish qualifications, previous employers, awards, or
                        client counts. Those details are not part of Azemax’s verified public record.
                        The absence of a claim here should not be read as a claim in the other
                        direction.
                    </p>
                </ArticleSection>

                <ArticleSection id="official-profiles" title="Official profiles and verification">
                    <p>
                        The links below are the external profiles and contact channels currently
                        verified by Azemax. New links are added only after the account is confirmed.
                    </p>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {LEADERSHIP.links.map((link) => (
                            <li
                                key={link.href}
                                className="rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4"
                            >
                                <a
                                    href={link.href}
                                    {...(link.external
                                        ? { target: '_blank', rel: 'noopener noreferrer' }
                                        : {})}
                                    className="rounded text-[13.5px] font-semibold text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                                >
                                    {link.label}
                                </a>
                                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--az-text-muted)]">
                                    {link.note}
                                </p>
                            </li>
                        ))}
                    </ul>
                    <Callout tone="info" title="A note on identity">
                        Azemax links only to profiles it has verified. A social account that is not
                        linked from this page is not an official Azemax profile, even if it uses the
                        same name or logo.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="azemax" title="Relationship to Azemax">
                    <p>
                        Azemax is the independent software organization that builds Azemax Studio.
                        {' '}
                        {LEADERSHIP.name} founded the organization and leads it as chief executive.
                        The <TextLink href="/about">About page</TextLink> publishes the official
                        company information, and the{' '}
                        <TextLink href="/leadership">leadership page</TextLink> records the published
                        leadership team.
                    </p>
                    <p>
                        For product support or company-level questions, use{' '}
                        <a
                            href={`mailto:${SITE.supportEmail}`}
                            className="rounded font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                        >
                            {SITE.supportEmail}
                        </a>{' '}
                        or the <TextLink href="/contact">contact page</TextLink>.
                    </p>
                </ArticleSection>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
                <CardLink href="/leadership" title="Azemax leadership">
                    The published leadership record for the organization.
                </CardLink>
                <CardLink href="/about" title="About Azemax">
                    What Azemax builds, its purpose, and official company information.
                </CardLink>
                <CardLink href="/features" title="Azemax Studio">
                    The editor, assistant, execution, and provider capabilities.
                </CardLink>
            </div>
        </PublicShell>
    );
};
