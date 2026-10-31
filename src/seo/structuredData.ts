/**
 * JSON-LD construction for the public site.
 *
 * Rules encoded here:
 *  - Azemax is modelled as an independent developer project, not a company.
 *  - No offers, prices, ratings, reviews, awards, or customer counts are
 *    emitted because none are verified on the public site.
 *  - SoftwareApplication featureList only names capabilities that exist in the
 *    shipped product.
 *  - FAQPage is generated from the same data that renders the visible answers.
 */

import { FAQ_ITEMS } from '../content/faqs';
import { SITE, absoluteUrl, type PublicPage } from './site';

const ORGANIZATION_ID = `${SITE.origin}/#organization`;
const WEBSITE_ID = `${SITE.origin}/#website`;
const SOFTWARE_ID = `${SITE.origin}/#software`;

const SOFTWARE_DESCRIPTION =
    'Azemax Studio is a browser-based AI code editor with a Monaco editing surface, an agentic assistant that can inspect and propose changes across workspace files, sandboxed code execution, diagnostics, and bring-your-own-key AI provider configuration.';

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
        name: SITE.name,
        alternateName: [SITE.shortName],
        description:
            'Official website for Azemax Studio, a browser-based AI code editor and agentic development workspace.',
        inLanguage: SITE.language,
        publisher: { '@id': ORGANIZATION_ID },
    };
}

function organizationNode(): Record<string, unknown> {
    return {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: SITE.shortName,
        url: SITE.url,
        logo: {
            '@type': 'ImageObject',
            url: `${SITE.origin}/img/icon-512.png`,
            width: 512,
            height: 512,
            caption: 'Azemax Studio logo',
        },
        description:
            'Azemax is the independent developer project behind Azemax Studio, a browser-based AI code editor.',
        email: SITE.supportEmail,
        sameAs: ['https://github.com/azemaxhq/azemax-studio'],
        founder: {
            '@type': 'Person',
            name: SITE.founderName,
            url: SITE.founderUrl,
            sameAs: [SITE.founderUrl],
        },
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
        featureList: FEATURE_LIST,
    };
}

function breadcrumbNode(page: PublicPage): Record<string, unknown> {
    const canonical = absoluteUrl(page.path);
    return {
        '@type': 'BreadcrumbList',
        '@id': `${canonical}#breadcrumb`,
        itemListElement: [
            {
                '@type': 'ListItem',
                position: 1,
                name: 'Home',
                item: SITE.url,
            },
            {
                '@type': 'ListItem',
                position: 2,
                name: page.label,
                item: canonical,
            },
        ],
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
 * WebSite/Organization entities plus its own node.
 */
export function buildStructuredData(page: PublicPage): Record<string, unknown> {
    const graph: Record<string, unknown>[] = [websiteNode(), organizationNode()];

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
