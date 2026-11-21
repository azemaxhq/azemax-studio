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
        'Tharunkumar T. is the founder and CEO of Azemax, an emerging technology startup building AI-powered software products, developer tools, and modern web applications. He leads the organization and its work on Azemax Studio.',
    bio: [
        'Tharunkumar T. founded Azemax and serves as its chief executive. Azemax is an emerging technology startup focused on artificial intelligence, developer tools, software engineering, intelligent automation, and modern web applications.',
        'As a young entrepreneur, he leads the organization’s direction and product work. Azemax Studio, the company’s browser-based AI code editor and agentic development workspace, combines a Monaco editing surface with an AI assistant that can inspect and change workspace files, sandboxed code execution, diagnostics, and optional bring-your-own-key model configuration.',
        'This page is maintained by Azemax as the canonical public profile for its founder and CEO. It is linked from the homepage, the About page, and the Leadership page so that the role can be checked against the organization’s official website.',
    ],
    professionalInterests: [
        'Building useful software products in the AI era.',
        'AI-powered applications and intelligent automation.',
        'Developer tools that make software work more direct.',
        'Modern web technologies and browser-based development.',
    ],
    softwareInterests: [
        'Web application development and developer tooling.',
        'AI-assisted coding workflows and agentic interfaces.',
        'Practical uses of large language models in software engineering.',
        'Accessible, browser-based development environments.',
    ],
    journey: [
        'Tharunkumar T. founded Azemax as a young entrepreneur and leads the organization as its CEO. Azemax is an independent, product-focused technology startup.',
        'Azemax’s public product is Azemax Studio, a browser-based AI code editor and agentic development workspace. The product is currently in public beta, and the documentation on this site describes what it does today rather than a future roadmap.',
        'The company’s public work is documented through this website and its GitHub organization. No funding, valuation, revenue, customer, or growth figures are claimed.',
    ],
    vision: [
        'Azemax’s published focus is to make a complete development loop available in the browser: write code, run it, understand what happened, and improve it without switching between disconnected tools.',
        'The company aims to build practical, accessible technology that uses modern AI to help people work, build, and innovate.',
    ],
    projects: [
        {
            name: 'Azemax Studio',
            description:
                'A browser-based AI code editor and agentic development workspace, currently in public beta.',
            href: '/features',
            external: false,
        },
        {
            name: 'Azemax on GitHub',
            description:
                'The official GitHub organization for Azemax and its public software work.',
            href: SITE.githubOrgUrl,
            external: true,
        },
        {
            name: 'Azemax Studio repository',
            description: 'The public source repository for Azemax Studio.',
            href: SITE.githubUrl,
            external: true,
        },
    ],
    knowsAbout: [
        'Software development',
        'AI-assisted software development',
        'Developer tools',
        'Web applications',
        'Browser-based development environments',
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
            label: 'Azemax on GitHub',
            href: SITE.githubOrgUrl,
            external: true,
            note: 'Official GitHub organization for Azemax.',
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
