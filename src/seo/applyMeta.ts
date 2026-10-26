/**
 * Client-side metadata synchronization.
 *
 * The build-time prerenderer writes the correct tags for every public route.
 * This module keeps those tags correct when the SPA changes routes without a
 * full reload (for example /privacy -> /terms, or landing -> sign in).
 *
 * Rules:
 *  - Public pages get a self-referencing canonical and index,follow.
 *  - Authenticated/auth surfaces get noindex,nofollow and NO canonical, so a
 *    private URL is never consolidated into a public one.
 *  - Unknown paths are treated as 404 and are not indexable.
 */

import { buildStructuredData } from './structuredData';
import {
    absoluteUrl,
    getPrivatePage,
    getPublicPage,
    SITE,
    type PrivatePage,
    type PublicPage,
} from './site';

const ROUTE_SCHEMA_SELECTOR = 'script[data-az-route-schema]';

type MetaAttribute = 'name' | 'property';

function upsertMeta(attribute: MetaAttribute, key: string, content: string): void {
    if (typeof document === 'undefined') return;
    const selector = `meta[${attribute}="${key}"]`;
    const existing = document.head.querySelector<HTMLMetaElement>(selector);
    if (existing) {
        existing.setAttribute('content', content);
        return;
    }
    const el = document.createElement('meta');
    el.setAttribute(attribute, key);
    el.setAttribute('content', content);
    document.head.appendChild(el);
}

function removeMeta(attribute: MetaAttribute, key: string): void {
    if (typeof document === 'undefined') return;
    document.head.querySelectorAll(`meta[${attribute}="${key}"]`).forEach((el) => el.remove());
}

function upsertCanonical(href: string | null): void {
    if (typeof document === 'undefined') return;
    const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
    if (!href) {
        links.forEach((el) => el.remove());
        return;
    }
    const first = links[0];
    if (first) {
        first.setAttribute('href', href);
        links.forEach((el, index) => {
            if (index > 0) el.remove();
        });
        return;
    }
    const link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', href);
    document.head.appendChild(link);
}

function replaceRouteSchema(schema: Record<string, unknown> | null): void {
    if (typeof document === 'undefined') return;
    const existing = document.head.querySelector<HTMLScriptElement>(ROUTE_SCHEMA_SELECTOR);
    if (!schema) {
        existing?.remove();
        return;
    }
    const script = existing ?? document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-az-route-schema', '');
    script.textContent = JSON.stringify(schema);
    if (!existing) document.head.appendChild(script);
}

function applyOpenGraph(page: { title: string; description: string; ogType: string; canonical: string | null }): void {
    const image = `${SITE.origin}${SITE.ogImagePath}`;
    upsertMeta('property', 'og:title', page.title);
    upsertMeta('property', 'og:description', page.description);
    upsertMeta('property', 'og:type', page.ogType);
    upsertMeta('property', 'og:site_name', SITE.name);
    upsertMeta('property', 'og:locale', SITE.locale);
    upsertMeta('property', 'og:image', image);
    upsertMeta('property', 'og:image:type', 'image/png');
    upsertMeta('property', 'og:image:width', String(SITE.ogImageWidth));
    upsertMeta('property', 'og:image:height', String(SITE.ogImageHeight));
    upsertMeta('property', 'og:image:alt', SITE.ogImageAlt);

    if (page.canonical) {
        upsertMeta('property', 'og:url', page.canonical);
    } else {
        removeMeta('property', 'og:url');
    }

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', page.title);
    upsertMeta('name', 'twitter:description', page.description);
    upsertMeta('name', 'twitter:image', image);
    upsertMeta('name', 'twitter:image:alt', SITE.ogImageAlt);
}

function applyPublic(page: PublicPage): void {
    const canonical = absoluteUrl(page.path);
    document.title = page.title;
    upsertMeta('name', 'description', page.description);
    upsertMeta(
        'name',
        'robots',
        'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
    );
    upsertCanonical(canonical);
    applyOpenGraph({
        title: page.title,
        description: page.description,
        ogType: page.ogType,
        canonical,
    });
    if (page.ogType === 'article') {
        upsertMeta('property', 'article:modified_time', page.lastmod);
    } else {
        removeMeta('property', 'article:modified_time');
    }
    replaceRouteSchema(buildStructuredData(page));
}

function applyPrivate(page: PrivatePage): void {
    document.title = page.title;
    upsertMeta('name', 'description', page.description);
    upsertMeta('name', 'robots', 'noindex, nofollow, noarchive');
    upsertCanonical(null);
    removeMeta('property', 'article:modified_time');
    applyOpenGraph({
        title: page.title,
        description: page.description,
        ogType: 'website',
        canonical: null,
    });
    replaceRouteSchema(null);
}

function applyNotFound(): void {
    const title = 'Page not found — Azemax Studio';
    const description = 'The requested page could not be found on Azemax Studio.';
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', 'noindex, nofollow, noarchive');
    upsertCanonical(null);
    removeMeta('property', 'article:modified_time');
    applyOpenGraph({
        title,
        description,
        ogType: 'website',
        canonical: null,
    });
    replaceRouteSchema(null);
}

/** Apply the correct metadata for a pathname. Safe to call on every route change. */
export function applyRouteMeta(pathname: string): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const publicPage = getPublicPage(pathname);
    if (publicPage) {
        applyPublic(publicPage);
        return;
    }

    const privatePage = getPrivatePage(pathname);
    if (privatePage) {
        applyPrivate(privatePage);
        return;
    }

    applyNotFound();
}
