/**
 * HTML <head> generation for the build-time prerenderer.
 *
 * Only build tooling imports this module. The browser uses `applyMeta.ts`,
 * which mutates the same tags after client-side navigation.
 */

import { SITE, absoluteUrl, type PrivatePage, type PublicPage } from './site';
import { buildStructuredData } from './structuredData';

export const SEO_BLOCK_START = '<!-- azemax:seo:start -->';
export const SEO_BLOCK_END = '<!-- azemax:seo:end -->';

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function serializeJsonLd(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function meta(name: string, content: string, attribute: 'name' | 'property' = 'name'): string {
    return `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}" />`;
}

function twitterBlock(title: string, description: string, image: string): string[] {
    return [
        meta('twitter:card', 'summary_large_image'),
        meta('twitter:title', title),
        meta('twitter:description', description),
        meta('twitter:image', image),
        meta('twitter:image:alt', SITE.ogImageAlt),
    ];
}

/**
 * Full SEO block for an indexable public page. The returned string is placed
 * between the markers in dist/index.html so the same template can produce
 * every route.
 */
export function renderPublicHead(page: PublicPage): string {
    const canonical = absoluteUrl(page.path);
    const image = `${SITE.origin}${page.ogImage ?? SITE.ogImagePath}`;
    const schema = buildStructuredData(page);

    const tags = [
        `<title>${escapeHtml(page.title)}</title>`,
        meta('description', page.description),
        `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
        meta(
            'robots',
            'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
        ),
        meta('og:title', page.title, 'property'),
        meta('og:description', page.description, 'property'),
        meta('og:type', page.ogType, 'property'),
        meta('og:url', canonical, 'property'),
        meta('og:site_name', SITE.name, 'property'),
        meta('og:locale', SITE.locale, 'property'),
        meta('og:image', image, 'property'),
        meta('og:image:type', 'image/png', 'property'),
        meta('og:image:width', String(SITE.ogImageWidth), 'property'),
        meta('og:image:height', String(SITE.ogImageHeight), 'property'),
        meta('og:image:alt', SITE.ogImageAlt, 'property'),
        ...twitterBlock(page.title, page.description, image),
    ];

    if (page.ogType === 'article') {
        tags.push(meta('article:modified_time', page.lastmod, 'property'));
        if (page.publishedDate) {
            tags.push(meta('article:published_time', page.publishedDate, 'property'));
        }
    }

    tags.push(
        `<script type="application/ld+json" data-az-route-schema>${serializeJsonLd(schema)}</script>`,
    );

    return `${SEO_BLOCK_START}\n  ${tags.join('\n  ')}\n  ${SEO_BLOCK_END}`;
}

/**
 * Private surfaces (workspace, auth, 404) carry no canonical and are explicitly
 * excluded from indexing. Authentication remains the access control; this tag
 * only prevents accidental search exposure.
 */
export function renderPrivateHead(page: PrivatePage): string {
    const tags = [
        `<title>${escapeHtml(page.title)}</title>`,
        meta('description', page.description),
        meta('robots', 'noindex, nofollow, noarchive'),
        meta('og:title', page.title, 'property'),
        meta('og:description', page.description, 'property'),
        meta('og:type', 'website', 'property'),
        meta('og:site_name', SITE.name, 'property'),
        ...twitterBlock(page.title, page.description, `${SITE.origin}${SITE.ogImagePath}`),
    ];
    return `${SEO_BLOCK_START}\n  ${tags.join('\n  ')}\n  ${SEO_BLOCK_END}`;
}

export function renderNotFoundHead(): string {
    const tags = [
        '<title>Page not found — Azemax Studio</title>',
        meta('description', 'The requested page could not be found on Azemax Studio.'),
        meta('robots', 'noindex, nofollow, noarchive'),
    ];
    return `${SEO_BLOCK_START}\n  ${tags.join('\n  ')}\n  ${SEO_BLOCK_END}`;
}
