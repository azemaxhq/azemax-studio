/**
 * Canonical public leadership record.
 *
 * The profile page, the leadership page, the About page, and the Person
 * structured data all read from this object so the visible copy and the
 * schema cannot drift apart.
 *
 * Only include facts that are verified and authorized for publication.
 * Do not add achievements, qualifications, employers, dates, or social
 * profiles that have not been confirmed by the person themselves.
 */
import { SITE } from '../seo/site';

export interface LeadershipLink {
    label: string;
    href: string;
    /** External links open in a new tab and are marked rel="noopener noreferrer". */
    external: boolean;
    /** Short factual note shown beside the link. */
    note: string;
}

export const LEADERSHIP = {
    name: SITE.founderName,
    /** Fallback monogram if the portrait fails to load. */
    initials: 'TT',
    jobTitle: SITE.founderJobTitle,
    roleLabel: `${SITE.founderJobTitle}, ${SITE.companyName}`,
    profilePath: SITE.founderProfilePath,
    profileUrl: SITE.founderUrl,
    /**
     * Verified professional photograph. The square crop is generated from the
     * supplied portrait and served as WebP at two widths. When set, the profile
     * pages render the image and the Person schema adds an `image` property.
     * Never point this at a stock photo or a placeholder.
     */
    photo: '/img/tharunkumar-t-avatar-960.webp',
    photoSrcSet:
        '/img/tharunkumar-t-avatar-512.webp 512w, /img/tharunkumar-t-avatar-960.webp 960w',
    photoWidth: 960,
    photoHeight: 960,
    photoAlt: 'Portrait of Tharunkumar T., founder and CEO of Azemax',
    summary:
        'Tharunkumar T. is the founder and CEO of Azemax. He leads the organization and its work on Azemax Studio, the browser-based AI code editor and agentic development workspace.',
    bio: [
        'Tharunkumar T. founded Azemax and serves as its chief executive. Azemax is the independent software organization behind Azemax Studio, a development workspace that runs in a modern web browser.',
        'Azemax Studio combines a Monaco editing surface with an AI assistant that can inspect and change workspace files, sandboxed code execution, diagnostics, and optional bring-your-own-key model configuration. The documentation and feature pages on this site describe the product as it currently ships.',
        'This page is maintained by Azemax as the canonical public profile for its founder and CEO. It is linked from the homepage, the About page, and the Leadership page so that the role can be checked against the organization’s official website.',
    ],
    responsibilities: [
        'Sets the direction and priorities for Azemax as an organization.',
        'Leads product work on Azemax Studio, the organization’s browser-based AI code editor.',
        'Represents Azemax in official communication and company-level inquiries.',
        'Maintains the accuracy of the official company and leadership information published on azemax.com.',
    ],
    sameAs: [SITE.founderExternalUrl, SITE.founderLinkedInUrl],
    links: [
        {
            label: 'Personal website',
            href: SITE.founderExternalUrl,
            external: true,
            note: 'Published independently of Azemax.',
        },
        {
            label: 'LinkedIn',
            href: SITE.founderLinkedInUrl,
            external: true,
            note: 'Professional profile on LinkedIn.',
        },
        {
            label: 'Azemax Studio on GitHub',
            href: SITE.githubUrl,
            external: true,
            note: 'Official public source repository for the project.',
        },
        {
            label: 'Email Azemax',
            href: `mailto:${SITE.supportEmail}`,
            external: false,
            note: 'Official support and company-level contact address.',
        },
    ] satisfies readonly LeadershipLink[],
} as const;

export type LeadershipPerson = typeof LEADERSHIP;
