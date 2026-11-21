/**
 * JSON-LD construction for the public site.
 *
 * Rules encoded here:
 *  - Azemax is modelled as an emerging technology startup behind Azemax
 *    Studio. No legal entity, address, VAT, or revenue claims are made.
 *  - The founder/CEO is a single Person entity referenced by @id everywhere,
 *    so Google sees one person connected to one organization rather than
 *    duplicate person objects on different pages.
 *  - No offers, prices, ratings, reviews, awards, or customer counts are
 *    emitted because none are verified on the public site.
 *  - SoftwareApplication featureList only names capabilities that exist in the
 *    shipped product.
 *  - FAQPage is generated from the same data that renders the visible answers.
 */

import { FAQ_ITEMS } from '../content/faqs';
import { LEADERSHIP } from '../content/leadership';
import { SITE, absoluteUrl, type PublicPage } from './site';

const ORGANIZATION_ID = `${SITE.origin}/#organization`;
const WEBSITE_ID = `${SITE.origin}/#website`;
const SOFTWARE_ID = `${SITE.origin}/#software`;
const PERSON_ID = `${SITE.founderUrl}#person`;
const PROFILE_PAGE_ID = `${SITE.founderUrl}#webpage`;

const SOFTWARE_DESCRIPTION =
    'Azemax Studio is a browser-based AI code editor from Azemax, an emerging technology startup. It has a Monaco editing surface, an agentic assistant that can inspect and propose changes across workspace files, sandboxed code execution, diagnostics, and bring-your-own-key AI provider configuration.';

const FEATURE_LIST = [
    'Monaco-based code editor with multi-tab editing and a workspace file tree',
    'Agentic AI assistant with read, search, write, rename, and delete tools',
    'Multi-file code changes with workspace validation',
    'Bring-your-own-key support for OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, NVIDIA NIM, and custom OpenAI-compatible endpoints',
    'Sandboxed code execution for supported languages',
    'AI explanations, structured refactoring proposals, and inline suggestions',
    'Account-scoped workspace and settings sync with Firebase authentication',
    'Unified diagnostics and problems panel',
];

function websiteNode(): Record<string, unknown> {
    return {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: SITE.url,
        name: SITE.companyName,
        alternateName: [SITE.name],
        description:
            'Official website for Azemax, an emerging technology startup, and its product Azemax Studio.',
        inLanguage: SITE.language,
        publisher: { '@id': ORGANIZATION_ID },
    };
}

function personNode(): Record<string, unknown> {
    const node: Record<string, unknown> = {
        '@type': 'Person',
        '@id': PERSON_ID,
        name: LEADERSHIP.name,
        jobTitle: LEADERSHIP.jobTitle,
        url: LEADERSHIP.profileUrl,
        description: LEADERSHIP.summary,
        worksFor: { '@id': ORGANIZATION_ID },
        mainEntityOfPage: { '@id': PROFILE_PAGE_ID },
        sameAs: [...LEADERSHIP.sameAs],
        knowsAbout: [...LEADERSHIP.knowsAbout],
    };

    if (LEADERSHIP.photo) {
        node.image = {
            '@type': 'ImageObject',
            url: `${SITE.origin}${LEADERSHIP.photo}`,
            width: LEADERSHIP.photoWidth,
            height: LEADERSHIP.photoHeight,
            caption: LEADERSHIP.photoAlt,
        };
    }

    return node;
}

function organizationNode(): Record<string, unknown> {
    return {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: SITE.companyName,
        url: SITE.url,
        logo: {
            '@type': 'ImageObject',
            url: `${SITE.origin}/img/icon-512.png`,
            width: 512,
            height: 512,
            caption: 'Azemax logo',
        },
        description: SITE.companyDescription,
        email: SITE.supportEmail,
        sameAs: [SITE.githubOrgUrl],
        knowsAbout: [...SITE.companyFocus],
        founder: { '@id': PERSON_ID },
        employee: [{ '@id': PERSON_ID }],
        brand: {
            '@type': 'Brand',
            name: SITE.name,
            logo: `${SITE.origin}/img/icon-512.png`,
        },
    };
}

function softwareNode(): Record<string, unknown> {
    return {
        '@type': 'SoftwareApplication',
        '@id': SOFTWARE_ID,
        name: SITE.name,
        alternateName: ['Azemax AI Code Editor'],
        applicationCategory: 'DeveloperApplication',
        applicationSubCategory: 'AI code editor',
        operatingSystem: 'Any (web browser)',
        browserRequirements:
            'Requires JavaScript and a current version of Chrome, Firefox, Safari, or Edge.',
        url: SITE.url,
        description: SOFTWARE_DESCRIPTION,
        softwareVersion: '1.0.0-beta',
        publisher: { '@id': ORGANIZATION_ID },
        sameAs: [SITE.githubUrl],
        featureList: FEATURE_LIST,
    };
}

function breadcrumbNode(page: PublicPage): Record<string, unknown> {
    const canonical = absoluteUrl(page.path);
    const items: Record<string, unknown>[] = [
        {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: SITE.url,
        },
    ];

    if (page.parent) {
        items.push({
            '@type': 'ListItem',
            position: 2,
            name: page.parent.label,
            item: absoluteUrl(page.parent.path),
        });
    }

    const position = items.length + 1;
    items.push({
        '@type': 'ListItem',
        position,
        name: page.label,
        item: canonical,
    });

    return {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: items,
    };
}

function faqNode(page: PublicPage): Record<string, unknown> {
    const canonical = absoluteUrl(page.path);
    return {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        url: canonical,
        name: 'Azemax Studio frequently asked questions',
        inLanguage: SITE.language,
        mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            '@id': `${canonical}#${item.id}`,
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
            },
        })),
    };
}

function pageNode(page: PublicPage): Record<string, unknown> {
    const canonical = absoluteUrl(page.path);
    const base: Record<string, unknown> = {
        '@id': `${canonical}#webpage`,
        url: canonical,
        name: page.title,
        description: page.description,
        isPartOf: { '@id': WEBSITE_ID },
        inLanguage: SITE.language,
        dateModified: page.lastmod,
    };

    // Article pages carry a genuine publication date.
    if (page.publishedDate) {
        base['datePublished'] = page.publishedDate;
    }

    if (page.key === 'contact') {
        return {
            ...base,
            '@type': 'ContactPage',
            mainEntity: { '@id': ORGANIZATION_ID },
        };
    }

    if (page.key === 'about') {
        return {
            ...base,
            '@type': 'AboutPage',
            about: { '@id': ORGANIZATION_ID },
            mainEntity: { '@id': ORGANIZATION_ID },
            breadcrumb: { '@id': `${canonical}#breadcrumb` },
        };
    }

    if (page.key === 'leadership') {
        return {
            ...base,
            '@type': 'CollectionPage',
            about: { '@id': ORGANIZATION_ID },
            mainEntity: {
                '@type': 'ItemList',
                '@id': `${canonical}#leadership`,
                name: 'Azemax leadership',
                itemListElement: [
                    {
                        '@type': 'ListItem',
                        position: 1,
                        item: { '@id': PERSON_ID },
                    },
                ],
            },
            breadcrumb: { '@id': `${canonical}#breadcrumb` },
        };
    }

    if (page.key === 'founder') {
        return {
            ...base,
            '@type': 'ProfilePage',
            about: { '@id': PERSON_ID },
            mainEntity: { '@id': PERSON_ID },
            breadcrumb: { '@id': `${canonical}#breadcrumb` },
        };
    }

    const node: Record<string, unknown> = {
        ...base,
        '@type': 'WebPage',
        about:
            page.key === 'privacy' || page.key === 'terms'
                ? { '@id': ORGANIZATION_ID }
                : { '@id': SOFTWARE_ID },
    };

    if (page.path !== '/') {
        node.breadcrumb = { '@id': `${canonical}#breadcrumb` };
    }
    if (page.key === 'faq') {
        node.mainEntity = { '@id': `${canonical}#faq` };
    }
    return node;
}

/**
 * Build the complete JSON-LD graph for one public page. The graph is replaced
 * wholesale on client-side navigation, so every page carries the shared
 * WebSite/Organization/Person entities plus its own node.
 */
export function buildStructuredData(page: PublicPage): Record<string, unknown> {
    const graph: Record<string, unknown>[] = [
        websiteNode(),
        organizationNode(),
        personNode(),
    ];

    if (
        page.key === 'home' ||
        page.key === 'features' ||
        page.key === 'docs' ||
        page.key === 'faq'
    ) {
        graph.push(softwareNode());
    }

    graph.push(pageNode(page));

    if (page.path !== '/') {
        graph.push(breadcrumbNode(page));
    }
    if (page.key === 'faq') {
        graph.push(faqNode(page));
    }

    return {
        '@context': 'https://schema.org',
        '@graph': graph,
    };
}
