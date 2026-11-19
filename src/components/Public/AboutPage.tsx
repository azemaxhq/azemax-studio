import React from 'react';
import {
    ArticleSection,
    CardLink,
    DataTable,
    H3,
    PageHero,
    TextLink,
} from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { PersonAvatar } from './PersonAvatar';
import { LEADERSHIP } from '../../content/leadership';
import { SITE } from '../../seo/site';

export const AboutPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/about" breadcrumb="About">
            <PageHero
                eyebrow="About Azemax"
                title={
                    <>
                        About
                        <span className="block text-[var(--az-accent)]">Azemax.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            Azemax is the independent software organization behind{' '}
                            <TextLink href="/">Azemax Studio</TextLink>, a browser-based AI code
                            editor and agentic development workspace.
                        </p>
                        <p>
                            This page states what the organization does, who leads it, and which
                            channels are official. It is the reference page for Azemax’s public
                            identity.
                        </p>
                    </>
                }
                meta="Last reviewed 19 November 2026"
            />

            <div className="mt-10 space-y-12">
                <ArticleSection id="what-azemax-is" title="What Azemax is">
                    <p>
                        Azemax builds and operates Azemax Studio. The product runs in a modern web
                        browser and is aimed at writing, running, understanding, and improving real
                        project code in one environment. It is currently in public beta.
                    </p>
                    <p>
                        Azemax is an independent developer project, not a large software vendor.
                        That matters for how support works: there is no ticket portal, phone line, or
                        live chat. Email is the official support channel, and replies are handled on
                        a best-effort basis.
                    </p>
                    <H3>What the product includes</H3>
                    <p>
                        Azemax Studio combines a Monaco editing surface, a workspace file tree,
                        multi-tab editing, and diagnostics with an AI assistant that can inspect and
                        change project files. Code can run in a hosted sandbox, and AI requests can
                        use the default Azemax configuration or a provider key supplied by the user.
                        The <TextLink href="/features">features page</TextLink> lists the shipped
                        capabilities, and the <TextLink href="/docs">documentation</TextLink> explains
                        how they are configured.
                    </p>
                </ArticleSection>

                <ArticleSection id="mission" title="Mission and focus">
                    <p>
                        The purpose of Azemax is to make a complete development loop available in the
                        browser: write code, run it, understand what happened, and improve it without
                        switching between disconnected tools. The product is built around that loop
                        rather than around a single feature.
                    </p>
                    <p>
                        Because Azemax Studio is in public beta, the published documentation describes
                        the current behaviour rather than a roadmap. Limitations, execution timeouts,
                        supported languages, and data-handling details are documented openly so users
                        can decide whether the product fits their work.
                    </p>
                </ArticleSection>

                <ArticleSection id="leadership" title="Leadership">
                    <p>
                        Azemax is founded and led by{' '}
                        <TextLink href={LEADERSHIP.profilePath}>{LEADERSHIP.name}</TextLink>, who serves
                        as {LEADERSHIP.jobTitle}. He is responsible for the direction of the
                        organization and for its work on Azemax Studio.
                    </p>
                    <div className="not-prose mt-5 flex flex-col gap-4 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4 sm:flex-row sm:items-center sm:p-5">
                        <PersonAvatar
                            name={LEADERSHIP.name}
                            initials={LEADERSHIP.initials}
                            photo={LEADERSHIP.photo}
                            photoSrcSet={LEADERSHIP.photoSrcSet}
                            photoAlt={LEADERSHIP.photoAlt}
                            size={72}
                        />
                        <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-[var(--az-text)]">
                                <a
                                    href={LEADERSHIP.profilePath}
                                    className="rounded underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                                >
                                    {LEADERSHIP.name}
                                </a>
                            </p>
                            <p className="mt-0.5 text-[13px] text-[var(--az-text-secondary)]">
                                {LEADERSHIP.roleLabel}
                            </p>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--az-text-muted)]">
                                Read the{' '}
                                <TextLink href={LEADERSHIP.profilePath}>official profile</TextLink>{' '}
                                or the <TextLink href="/leadership">leadership page</TextLink> for his
                                published role and responsibilities.
                            </p>
                        </div>
                    </div>
                </ArticleSection>

                <ArticleSection id="official-information" title="Official company information">
                    <p>
                        The table below is the canonical company information published by Azemax.
                        Use it when verifying the organization, the product, or the leadership
                        profile.
                    </p>
                    <DataTable
                        caption="Official Azemax company information"
                        head={['Item', 'Official information']}
                        rows={[
                            ['Organization', SITE.companyName],
                            ['Product', SITE.name],
                            ['Founder and CEO', LEADERSHIP.name],
                            [
                                'Official website',
                                <TextLink href="/" key="website">
                                    www.azemax.com
                                </TextLink>,
                            ],
                            [
                                'Support and company contact',
                                <a
                                    key="email"
                                    href={`mailto:${SITE.supportEmail}`}
                                    className="break-all font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)]"
                                >
                                    {SITE.supportEmail}
                                </a>,
                            ],
                            [
                                'Public source repository',
                                <TextLink href={SITE.githubUrl} external key="github">
                                    github.com/azemaxhq/azemax-studio
                                </TextLink>,
                            ],
                            ['Headquarters or registered address', 'Not published'],
                            ['Public phone number', 'Not offered'],
                        ]}
                    />
                    <p className="text-[12.5px] text-[var(--az-text-muted)]">
                        Azemax has not published a registered corporate address or a public phone
                        number. Do not treat third-party directory listings as official unless they
                        match the information on this page.
                    </p>
                </ArticleSection>

                <ArticleSection id="official-channels" title="Official channels">
                    <p>
                        The website and the support email above are the official Azemax channels.
                        The public source repository is the official code location. A profile or page
                        that is not linked from this website should not be assumed to represent
                        Azemax.
                    </p>
                    <p>
                        For product support, security reports, privacy requests, or company-level
                        questions, use the <TextLink href="/contact">contact page</TextLink>.
                    </p>
                </ArticleSection>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
                <CardLink href={LEADERSHIP.profilePath} title="Founder and CEO profile">
                    The official role, biography, and responsibilities of {LEADERSHIP.name}.
                </CardLink>
                <CardLink href="/leadership" title="Leadership">
                    Who leads Azemax and how the published leadership record is maintained.
                </CardLink>
                <CardLink href="/features" title="Product features">
                    The editor, assistant, execution, providers, and account behaviour.
                </CardLink>
            </div>
        </PublicShell>
    );
};
