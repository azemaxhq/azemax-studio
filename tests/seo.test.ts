/**
 * SEO registry, metadata, and public-page render tests.
 *
 * These assertions guard the contract between the route registry, the
 * build-time prerenderer, and the visible pages: one canonical URL per page,
 * unique titles, truthful structured data, and grounded public copy.
 */
import { check, finish } from './_harness';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    PUBLIC_PAGES,
    PUBLIC_PAGE_LIST,
    PRIVATE_PAGES,
    SITE,
    absoluteUrl,
    getPrivatePage,
    getPublicPage,
    isContentPagePath,
    isPrivateAppPath,
    isPrivateAuthPath,
    normalizePathname,
    resolveRoute,
    sitemapPages,
} from '../src/seo/site';
import { buildStructuredData } from '../src/seo/structuredData';
import { renderNotFoundHead, renderPrivateHead, renderPublicHead } from '../src/seo/head';
import { FAQ_ITEMS } from '../src/content/faqs';
import { FeaturesPage } from '../src/components/Public/FeaturesPage';
import { DocsPage } from '../src/components/Public/DocsPage';
import { FaqPage } from '../src/components/Public/FaqPage';
import { ContactPage } from '../src/components/Public/ContactPage';
import { NotFoundPage } from '../src/components/Public/NotFoundPage';
import { LegalPage } from '../src/components/Legal/LegalPage';

// --- Path normalization and route resolution ---
{
    check('normalize strips a trailing slash', normalizePathname('/features/') === '/features');
    check('normalize keeps the root', normalizePathname('/') === '/');
    check('normalize strips query and hash', normalizePathname('/docs?x=1#providers') === '/docs');
    check('normalize collapses repeated trailing slashes', normalizePathname('/faq///') === '/faq');

    check('home resolves as public', resolveRoute('/').kind === 'public');
    check('features resolves as public', resolveRoute('/features').kind === 'public');
    check('docs resolves as public', resolveRoute('/docs').kind === 'public');
    check('faq resolves as public', resolveRoute('/faq').kind === 'public');
    check('contact resolves as public', resolveRoute('/contact').kind === 'public');
    check('privacy resolves as public', resolveRoute('/privacy').kind === 'public');
    check('terms resolves as public', resolveRoute('/terms').kind === 'public');
    check('trailing slash still resolves', resolveRoute('/privacy/').kind === 'public');
    check('app resolves as private', resolveRoute('/app').kind === 'private');
    check('app subpath resolves as private', resolveRoute('/app/project/1').kind === 'private');
    check('login resolves as private', resolveRoute('/login').kind === 'private');
    check('auth callback resolves as private', resolveRoute('/auth/callback').kind === 'private');
    check('unknown path is not found', resolveRoute('/nonexistent-xyz').kind === 'not-found');
    check('path that merely starts with app is not the app', resolveRoute('/application').kind === 'not-found');

    check('isPrivateAppPath is segment-exact', isPrivateAppPath('/app/x') && !isPrivateAppPath('/apple'));
    check('isPrivateAuthPath matches auth routes', isPrivateAuthPath('/signup') && !isPrivateAuthPath('/signup/extra'));
    check('isContentPagePath excludes home', !isContentPagePath('/') && isContentPagePath('/docs'));
    check('getPublicPage returns null for private routes', getPublicPage('/login') === null);
    check('getPrivatePage maps /app/* to the app shell', getPrivatePage('/app/deep')?.path === '/app');
}

// --- Registry invariants ---
{
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    const paths = new Set<string>();

    for (const page of PUBLIC_PAGE_LIST) {
        check(`${page.key}: path is canonical`, page.path === '/' || !page.path.endsWith('/'));
        check(`${page.key}: unique path`, !paths.has(page.path));
        check(`${page.key}: unique title`, !titles.has(page.title));
        check(`${page.key}: unique description`, !descriptions.has(page.description));
        check(`${page.key}: description is substantive`, page.description.length >= 80);
        check(`${page.key}: lastmod is an ISO date`, /^\d{4}-\d{2}-\d{2}$/.test(page.lastmod));
        paths.add(page.path);
        titles.add(page.title);
        descriptions.add(page.description);
    }

    check('seven public pages are registered', PUBLIC_PAGE_LIST.length === 7);
    check('sitemap includes every indexable public page', sitemapPages().length === PUBLIC_PAGE_LIST.filter((p) => p.indexable).length);
    check('private routes are absent from the sitemap', sitemapPages().every((p) => !p.path.startsWith('/app') && p.path !== '/login'));
    check('canonical root has no duplicate slash', absoluteUrl('/') === SITE.url);
    check('canonical detail page is absolute', absoluteUrl('/docs') === `${SITE.origin}/docs`);
    check('canonical ignores trailing slash', absoluteUrl('/docs/') === `${SITE.origin}/docs`);
}

// --- Structured data ---
{
    for (const page of PUBLIC_PAGE_LIST) {
        const data = buildStructuredData(page) as { '@graph': Array<Record<string, unknown>> };
        check(`${page.key}: JSON-LD has a graph`, Array.isArray(data['@graph']) && data['@graph'].length >= 3);
        const types = data['@graph'].map((node) => node['@type']);
        check(`${page.key}: JSON-LD has WebSite`, types.includes('WebSite'));
        check(`${page.key}: JSON-LD has Organization`, types.includes('Organization'));
        check(`${page.key}: JSON-LD has a page node`, types.includes('WebPage') || types.includes('ContactPage'));

        const org = data['@graph'].find((node) => node['@type'] === 'Organization');
        check(`${page.key}: Organization links the founder`, (org?.founder as { url?: string })?.url === SITE.founderUrl);
        check(`${page.key}: Organization is not a corporation claim`, String(org?.description).includes('independent developer project') && org?.legalName === undefined && org?.vatID === undefined && org?.taxID === undefined);

        const software = data['@graph'].find((node) => node['@type'] === 'SoftwareApplication') as Record<string, unknown> | undefined;
        if (software) {
            check(`${page.key}: no pricing offer`, software.offers === undefined);
            check(`${page.key}: no aggregate rating`, software.aggregateRating === undefined);
            check(`${page.key}: feature list is present`, Array.isArray(software.featureList) && software.featureList.length > 0);
        }
    }

    const faqData = buildStructuredData(PUBLIC_PAGES.faq) as { '@graph': Array<Record<string, unknown>> };
    const faq = faqData['@graph'].find((node) => node['@type'] === 'FAQPage') as { mainEntity?: unknown[] } | undefined;
    check('FAQPage is emitted on /faq', Boolean(faq));
    check('FAQPage uses the visible FAQ data', faq?.mainEntity?.length === FAQ_ITEMS.length);
}

// --- Head generation ---
{
    const head = renderPublicHead(PUBLIC_PAGES.docs);
    check('public head includes the title', head.includes(`<title>${PUBLIC_PAGES.docs.title}</title>`));
    check('public head includes the canonical', head.includes(`<link rel="canonical" href="${SITE.origin}/docs" />`));
    check('public head is index,follow', head.includes('name="robots" content="index, follow'));
    check('public head includes og:image dimensions', head.includes('property="og:image:width" content="1200"'));
    check('public head includes JSON-LD', head.includes('application/ld+json'));

    const privateHead = renderPrivateHead(PRIVATE_PAGES[0]);
    check('private head is noindex', privateHead.includes('noindex, nofollow'));
    check('private head has no canonical', !privateHead.includes('rel="canonical"'));

    const notFound = renderNotFoundHead();
    check('404 head is noindex', notFound.includes('noindex, nofollow'));
    check('404 head has no canonical', !notFound.includes('rel="canonical"'));
}

// --- FAQ content ---
{
    const ids = new Set<string>();
    for (const item of FAQ_ITEMS) {
        check(`faq ${item.id}: unique id`, !ids.has(item.id));
        check(`faq ${item.id}: question ends with a question mark`, item.question.trim().endsWith('?'));
        check(`faq ${item.id}: answer is substantive`, item.answer.length >= 120);
        ids.add(item.id);
    }
    check('faq has at least ten answers', FAQ_ITEMS.length >= 10);
    check('faq states that agent edits are live', FAQ_ITEMS.some((item) => /Agent and Edit modes can create, modify/.test(item.answer)));
    check('faq does not claim a public PTY shell', FAQ_ITEMS.every((item) => !/\bPTY\b/.test(item.answer)));
}

// --- Public page rendering ---
{
    const pages = [
        ['features', createElement(FeaturesPage)],
        ['docs', createElement(DocsPage)],
        ['faq', createElement(FaqPage)],
        ['contact', createElement(ContactPage)],
        ['not-found', createElement(NotFoundPage)],
        ['privacy', createElement(LegalPage, { path: '/privacy' })],
        ['terms', createElement(LegalPage, { path: '/terms' })],
    ] as const;

    for (const [name, element] of pages) {
        const html = renderToStaticMarkup(element);
        check(`${name}: renders substantive markup`, html.length > 3000);
        check(`${name}: has exactly one h1`, (html.match(/<h1[\s>]/g) || []).length === 1);
        check(`${name}: has a main landmark`, html.includes('<main'));
        check(`${name}: has a footer`, html.includes('<footer'));
        check(`${name}: links home`, html.includes('href="/"'));
        check(`${name}: contains no localhost URL`, !html.includes('localhost') && !html.includes('127.0.0.1'));
    }

    const features = renderToStaticMarkup(createElement(FeaturesPage));
    check('features links the docs', features.includes('href="/docs"'));
    check('features links the FAQ', features.includes('href="/faq"'));
    check('features names the hosted sandbox', features.includes('Wandbox'));
    check('features warns that edits are live', features.includes('live edits'));
    check('features denies a hosted general-purpose shell', features.includes('does not expose that shell'));

    const docs = renderToStaticMarkup(createElement(DocsPage));
    check('docs covers assistant modes', docs.includes('Agent') && docs.includes('Ask') && docs.includes('Edit'));
    check('docs covers provider settings', docs.includes('Settings → AI Providers'));
    check('docs explains key storage', docs.includes('Remember on this device'));
    check('docs lists execution limits', docs.includes('60 seconds') && docs.includes('30 seconds'));

    const contact = renderToStaticMarkup(createElement(ContactPage));
    check('contact exposes the support email', contact.includes(`mailto:${SITE.supportEmail}`));
    check('contact offers an account-deletion subject', contact.includes('Account%20deletion'));

    const faq = renderToStaticMarkup(createElement(FaqPage));
    check('faq renders every visible answer', FAQ_ITEMS.every((item) => faq.includes(item.question)));
    check('faq answers are in the DOM, not only the schema', FAQ_ITEMS.every((item) => faq.includes(item.answer)));
}

finish('SEO, metadata, and public pages');
