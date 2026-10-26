import React from 'react';
import { Mail, ShieldAlert, Bug, UserX } from 'lucide-react';
import { ArticleSection, Callout, CardLink, PageHero, TextLink } from './Article';
import { PublicShell, usePublicPageScroll } from './PublicShell';
import { SITE } from '../../seo/site';

const SUBJECTS = [
    {
        icon: Bug,
        title: 'Product support and bug reports',
        body: 'Describe the browser, the page or action involved, what you expected, and what happened. Screenshots and exact error text help. Do not include API keys, passwords, or private source code.',
        subject: 'Azemax support',
    },
    {
        icon: UserX,
        title: 'Account and data deletion',
        body: 'Send the request from the email address associated with the account and state that you want the account and associated server-side data deleted. Self-service account deletion is not implemented yet, so this is handled manually.',
        subject: 'Account deletion',
    },
    {
        icon: ShieldAlert,
        title: 'Security reports',
        body: 'Report suspected vulnerabilities privately by email. Include reproduction steps and the impact you believe is possible. Do not test against other users’ accounts or run disruptive load against production.',
        subject: 'Security report',
    },
] as const;

export const ContactPage: React.FC = () => {
    usePublicPageScroll();

    return (
        <PublicShell path="/contact" breadcrumb="Contact">
            <PageHero
                eyebrow="Contact and support"
                title={
                    <>
                        Reach the person
                        <span className="block text-[var(--az-accent)]">who builds Azemax.</span>
                    </>
                }
                intro={
                    <>
                        <p>
                            Azemax Studio is an independent developer project. Email is the only support
                            channel currently offered; there is no ticket portal, live chat, or phone line.
                        </p>
                        <p>
                            Support is handled on a best-effort basis. Including enough detail in your first
                            message makes a useful reply much more likely.
                        </p>
                    </>
                }
                meta="Last reviewed 26 October 2026"
            />

            <div className="mt-8 rounded-[var(--az-radius-lg)] border border-[var(--az-border)] bg-[var(--az-surface)] p-5 sm:p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--az-text-muted)]">
                    Support email
                </p>
                <a
                    href={`mailto:${SITE.supportEmail}`}
                    className="mt-2 inline-flex items-center gap-2 break-all text-[20px] font-semibold tracking-[-0.01em] text-[var(--az-accent)] transition-colors hover:text-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50 sm:text-[24px]"
                >
                    <Mail size={20} aria-hidden="true" />
                    {SITE.supportEmail}
                </a>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--az-text-muted)]">
                    Email is also the address used for privacy requests and legal notices. See the{' '}
                    <TextLink href="/privacy">Privacy Policy</TextLink> for how requests are handled.
                </p>
            </div>

            <div className="mt-12 space-y-10">
                <ArticleSection id="what-to-send" title="What to include">
                    <p>
                        A clear first message usually means fewer round trips. Depending on the request,
                        include:
                    </p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>The email address on your Azemax account, if the request is account-specific.</li>
                        <li>The browser and operating system you used.</li>
                        <li>The page, panel, or action involved, and the steps that led to it.</li>
                        <li>The exact error message or a screenshot of the problem.</li>
                        <li>Whether you were using Azemax Default or Bring Your Own Key, if AI is involved.</li>
                    </ul>
                    <Callout tone="warn" title="Never send credentials">
                        Do not send API keys, passwords, verification codes, or private source code. Azemax
                        support does not need them, and email is not a secure secret store.
                    </Callout>
                </ArticleSection>

                <ArticleSection id="request-types" title="Request types">
                    <div className="grid gap-3">
                        {SUBJECTS.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={item.title}
                                    className="rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface)] p-4 sm:p-5"
                                >
                                    <p className="flex items-center gap-2 text-[14px] font-semibold text-[var(--az-text)]">
                                        <Icon size={15} className="text-[var(--az-accent)]" aria-hidden="true" />
                                        {item.title}
                                    </p>
                                    <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--az-text-secondary)]">
                                        {item.body}
                                    </p>
                                    <a
                                        href={`mailto:${SITE.supportEmail}?subject=${encodeURIComponent(item.subject)}`}
                                        className="mt-3 inline-flex items-center gap-1.5 rounded text-[12.5px] font-medium text-[var(--az-accent)] underline decoration-[var(--az-accent)]/40 underline-offset-2 transition-colors hover:text-[var(--az-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--az-accent)]/50"
                                    >
                                        Email with this subject
                                    </a>
                                </div>
                            );
                        })}
                    </div>
                </ArticleSection>

                <ArticleSection id="before-you-write" title="Before you write">
                    <p>
                        Many setup and execution questions are already answered. The{' '}
                        <TextLink href="/docs">documentation</TextLink> covers account verification, provider
                        configuration, key storage, run limits, and common failures. The{' '}
                        <TextLink href="/faq">FAQ</TextLink> covers account deletion, offline use, supported
                        languages, and pricing.
                    </p>
                    <p>
                        For a product issue, check whether it reproduces after a reload and in a different
                        browser profile with extensions disabled. That distinguishes an application problem
                        from a local extension or network issue.
                    </p>
                </ArticleSection>

                <ArticleSection id="security" title="Security and abuse">
                    <p>
                        Report vulnerabilities privately rather than opening a public issue. Do not access
                        another user’s data, disrupt the service, or use the execution sandbox to attack
                        third parties. The <TextLink href="/terms">Terms of Service</TextLink> describe
                        prohibited use, and the security section of the{' '}
                        <TextLink href="/privacy">Privacy Policy</TextLink> describes how data is handled.
                    </p>
                </ArticleSection>
            </div>

            <div className="mt-12 grid gap-3 sm:grid-cols-3">
                <CardLink href="/docs" title="Documentation">
                    Setup, workspace basics, provider configuration, and troubleshooting.
                </CardLink>
                <CardLink href="/faq" title="FAQ">
                    Direct answers about accounts, keys, execution, and privacy.
                </CardLink>
                <CardLink href="/privacy" title="Privacy Policy">
                    Data categories, providers, retention, and deletion.
                </CardLink>
            </div>
        </PublicShell>
    );
};
