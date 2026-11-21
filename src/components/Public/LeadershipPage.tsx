import React from 'react';
import {
    ArticleSection,
    CardLink,
    PageHero,
    TextLink,
} from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { PersonAvatar } from './PersonAvatar';
import { LEADERSHIP } from '../../content/leadership';

export const LeadershipPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/leadership" breadcrumb="Leadership">
            <PageHero
                eyebrow="Leadership"
                title={
                    <>
                        The people who
                        <span className="block text-[var(--az-accent)]">lead Azemax.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            Azemax is an emerging technology startup. It publishes its leadership
                            record on this site so the company and its product can be verified against
                            an official source.
                        </p>
                        <p>
                            The leadership team currently consists of the founder and CEO. No other
                            executives or board members are publicly listed.
                        </p>
                    </>
                }
                meta="Last reviewed 20 November 2026"
            />

            <div className="mt-10 space-y-12">
                <section aria-labelledby="leadership-team-heading">
                    <h2
                        id="leadership-team-heading"
                        className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--az-text)] sm:text-[25px]"
                    >
                        Leadership team
                    </h2>

                    <div className="mt-5 rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:p-6">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                            <PersonAvatar
                                name={LEADERSHIP.name}
                                initials={LEADERSHIP.initials}
                                photo={LEADERSHIP.photo}
                                photoSrcSet={LEADERSHIP.photoSrcSet}
                                photoAlt={LEADERSHIP.photoAlt}
                                size={96}
                            />
                            <div className="min-w-0">
                                <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--az-text)]">
                                    <a
                                        href={LEADERSHIP.profilePath}
                                        className="rounded transition-colors hover:text-[var(--az-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                                    >
                                        {LEADERSHIP.name}
                                    </a>
                                </h3>
                                <p className="mt-1 text-[13.5px] font-medium text-[var(--az-accent)]">
                                    {LEADERSHIP.roleLabel}
                                </p>
                                <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[var(--az-text-secondary)]">
                                    Responsible for the direction of Azemax and for its work on
                                    Azemax Studio. His published responsibilities and professional
                                    biography are on the official profile page.
                                </p>
                                <a
                                    href={LEADERSHIP.profilePath}
                                    className="mt-4 inline-flex min-h-[38px] items-center rounded-md border border-[var(--az-border)] bg-[var(--az-surface-2)] px-3.5 py-2 text-[13px] font-medium text-[var(--az-text-secondary)] transition-colors hover:border-[var(--az-accent-border)] hover:text-[var(--az-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                                >
                                    View the official profile
                                </a>
                            </div>
                        </div>
                    </div>
                </section>

                <ArticleSection id="role" title="The role of the founder and CEO">
                    <p>
                        {LEADERSHIP.name} founded Azemax and serves as its chief executive. The role
                        covers the company’s direction, product priorities for Azemax Studio, and
                        official representation of the organization.
                    </p>
                    <p>
                        Azemax is an ambitious, product-focused technology startup working on
                        AI-powered applications, developer tools, intelligent automation, and modern
                        web technologies. The founder and CEO leads that work.
                    </p>
                    <p>
                        Azemax does not publish a separate management layer, advisory board, or
                        investor list. If that changes, this page and the individual profile will be
                        updated together.
                    </p>
                </ArticleSection>

                <ArticleSection id="verification" title="How to verify this information">
                    <p>
                        The <TextLink href={LEADERSHIP.profilePath}>founder and CEO profile</TextLink>{' '}
                        is the canonical page for his role. The{' '}
                        <TextLink href="/about">About page</TextLink> publishes the official company
                        information, and the <TextLink href="/contact">contact page</TextLink> lists
                        the support channel.
                    </p>
                    <p>
                        Links to external profiles are included only when they have been verified by
                        Azemax. Social accounts that are not linked from the profile page should not
                        be treated as official.
                    </p>
                </ArticleSection>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
                <CardLink href={LEADERSHIP.profilePath} title="Founder and CEO profile">
                    Role, biography, responsibilities, and verified professional links.
                </CardLink>
                <CardLink href="/about" title="About Azemax">
                    What the organization builds and the official company information.
                </CardLink>
                <CardLink href="/contact" title="Contact">
                    Product support, account requests, security reports, and company inquiries.
                </CardLink>
            </div>
        </PublicShell>
    );
};
