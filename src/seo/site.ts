/**
 * Single source of truth for public URLs, titles, descriptions, and the
 * social-sharing image.
 *
 * This module is intentionally dependency-free (no React, no DOM) so the Vite
 * build-time prerenderer, the browser metadata updater, and the unit tests can
 * all read the same values. Never hard-code a public URL or page title
 * anywhere else.
 */

export const SITE = {
    origin: 'https://www.azemax.com',
    url: 'https://www.azemax.com/',
    name: 'Azemax Studio',
    shortName: 'Azemax',
    supportEmail: 'azemaxhq@gmail.com',
    locale: 'en_US',
    language: 'en',
    founderName: 'Tharun Kumar',
    founderUrl: 'https://www.tharunkumar.site/',
    ogImagePath: '/img/azemax-studio-og.png',
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageAlt: 'Azemax Studio — AI code editor and agentic development workspace',
} as const;

export type PublicPageKey =
    | 'home'
    | 'features'
    | 'docs'
    | 'faq'
    | 'contact'
    | 'privacy'
    | 'terms';

export interface PublicPage {
    key: PublicPageKey;
    /** Same-origin pathname. Always the canonical form (no trailing slash). */
    path: string;
    /** Unique <title> for this route. */
    title: string;
    /** Unique meta description, written for humans (no keyword stuffing). */
    description: string;
    /** Visible page label used by breadcrumbs and the footer. */
    label: string;
    /** ISO date used by sitemap.xml. Update when the page content changes. */
    lastmod: string;
    /** ISO date the page was first published (article pages). */
    publishedDate?: string;
    /** Include in sitemap.xml and expose index,follow. */
    indexable: boolean;
    /** Open Graph object type. */
    ogType: 'website' | 'article';
    /** Page-specific Open Graph image path. Falls back to SITE.ogImagePath when absent. */
    ogImage?: string;
}

export const PUBLIC_PAGES: Record<PublicPageKey, PublicPage> = {
    home: {
        key: 'home',
        path: '/',
        title: 'Azemax Studio — AI Code Editor with an Agentic Assistant',
        description:
            'Azemax Studio is a browser-based AI code editor with Monaco, an agentic assistant that edits files, sandboxed code execution, and bring-your-own-key models.',
        label: 'Home',
        lastmod: '2026-10-26',
        indexable: true,
        ogType: 'website',
    },
    features: {
        key: 'features',
        path: '/features',
        title: 'Features — Agentic AI Code Editing | Azemax Studio',
        description:
            "Explore Azemax Studio's Monaco editor, multi-file agent workflows, sandboxed code execution, diagnostics, workspace sync, and BYOK model configuration.",
        label: 'Features',
        lastmod: '2026-10-26',
        indexable: true,
        ogType: 'website',
    },
    docs: {
        key: 'docs',
        path: '/docs',
        title: 'Documentation and Getting Started | Azemax Studio',
        description:
            'Set up Azemax Studio, open your first workspace, use the AI assistant and agent mode, configure a provider key, run code, and troubleshoot common issues.',
        label: 'Documentation',
        lastmod: '2026-10-26',
        indexable: true,
        ogType: 'website',
    },
    faq: {
        key: 'faq',
        path: '/faq',
        title: 'FAQ — AI Code Editor Questions | Azemax Studio',
        description:
            'Answers about Azemax Studio accounts, AI providers, bring-your-own-key keys, code execution, data handling, supported languages, and the public beta.',
        label: 'FAQ',
        lastmod: '2026-10-26',
        indexable: true,
        ogType: 'website',
    },
    contact: {
        key: 'contact',
        path: '/contact',
        title: 'Contact and Support | Azemax Studio',
        description:
            'Contact Azemax Studio for product support, bug reports, account or privacy requests, and security reports. Email is the only support channel currently offered.',
        label: 'Contact',
        lastmod: '2026-10-26',
        indexable: true,
        ogType: 'website',
    },
    privacy: {
        key: 'privacy',
        path: '/privacy',
        title: 'Privacy Policy — Azemax Studio',
        description:
            'How Azemax Studio handles account data, workspace files, AI prompts, provider requests, code execution, retention, and your privacy choices.',
        label: 'Privacy Policy',
        lastmod: '2026-10-18',
        publishedDate: '2026-10-18',
        indexable: true,
        ogType: 'article',
    },
    terms: {
        key: 'terms',
        path: '/terms',
        title: 'Terms of Service — Azemax Studio',
        description:
            'The terms that govern use of Azemax Studio, including accounts, acceptable use, AI output, code execution risks, content ownership, and liability.',
        label: 'Terms of Service',
        lastmod: '2026-10-18',
        publishedDate: '2026-10-18',
        indexable: true,
        ogType: 'article',
    },
};

export const PUBLIC_PAGE_LIST: readonly PublicPage[] = Object.values(PUBLIC_PAGES);

/** Pages that must never appear in a sitemap or be indexed. */
export interface PrivatePage {
    path: string;
    title: string;
    description: string;
    /** app = authenticated workspace; auth = sign-in surface. */
    surface: 'app' | 'auth';
}

export const PRIVATE_PAGES: readonly PrivatePage[] = [
    {
        path: '/app',
        title: 'Workspace — Azemax Studio',
        description: 'The authenticated Azemax Studio development workspace.',
        surface: 'app',
    },
    {
        path: '/login',
        title: 'Sign in — Azemax Studio',
        description: 'Sign in to your Azemax Studio account.',
        surface: 'auth',
    },
    {
        path: '/signup',
        title: 'Create an account — Azemax Studio',
        description: 'Create an Azemax Studio account.',
        surface: 'auth',
    },
    {
        path: '/forgot-password',
        title: 'Reset password — Azemax Studio',
        description: 'Reset the password for your Azemax Studio account.',
        surface: 'auth',
    },
    {
        path: '/verify-email',
        title: 'Verify your email — Azemax Studio',
        description: 'Verify the email address for your Azemax Studio account.',
        surface: 'auth',
    },
    {
        path: '/auth/callback',
        title: 'Signing in — Azemax Studio',
        description: 'Completing sign-in to Azemax Studio.',
        surface: 'auth',
    },
];

export const NOT_FOUND_PAGE = {
    path: '/404',
    title: 'Page not found — Azemax Studio',
    description: 'The requested page could not be found on Azemax Studio.',
} as const;

/** Same-origin auth routes, kept in sync with appRouter.AUTH_ROUTES. */
const AUTH_PATHS = new Set<string>([
    '/login',
    '/signup',
    '/forgot-password',
    '/verify-email',
    '/auth/callback',
]);

/**
 * Normalize a pathname for routing / metadata lookup: strip trailing slashes
 * (except for the root) and ignore query strings and fragments.
 */
export function normalizePathname(pathname: string): string {
    if (typeof pathname !== 'string' || pathname.length === 0) return '/';
    let path = pathname.split(/[?#]/)[0] || '/';
    if (!path.startsWith('/')) path = `/${path}`;
    if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
    return path || '/';
}

export function getPublicPage(pathname: string): PublicPage | null {
    const path = normalizePathname(pathname);
    return PUBLIC_PAGE_LIST.find((page) => page.path === path) ?? null;
}

export function isContentPagePath(pathname: string): boolean {
    const page = getPublicPage(pathname);
    return page !== null && page.key !== 'home';
}

/** True for the authenticated workspace, including /app/* sub-paths. */
export function isPrivateAppPath(pathname: string): boolean {
    const path = normalizePathname(pathname);
    return path === '/app' || path.startsWith('/app/');
}

export function isPrivateAuthPath(pathname: string): boolean {
    return AUTH_PATHS.has(normalizePathname(pathname));
}

export function getPrivatePage(pathname: string): PrivatePage | null {
    const path = normalizePathname(pathname);
    if (isPrivateAppPath(path)) return PRIVATE_PAGES[0];
    return PRIVATE_PAGES.find((page) => page.path === path) ?? null;
}

export type ResolvedRoute =
    | { kind: 'public'; page: PublicPage }
    | { kind: 'private'; page: PrivatePage }
    | { kind: 'not-found' };

export function resolveRoute(pathname: string): ResolvedRoute {
    const publicPage = getPublicPage(pathname);
    if (publicPage) return { kind: 'public', page: publicPage };
    const privatePage = getPrivatePage(pathname);
    if (privatePage) return { kind: 'private', page: privatePage };
    return { kind: 'not-found' };
}

/** Canonical absolute URL for a path (no trailing slash except root). */
export function absoluteUrl(pathname: string): string {
    const path = normalizePathname(pathname);
    return path === '/' ? SITE.url : `${SITE.origin}${path}`;
}

/** Pages eligible for sitemap.xml, in a stable order. */
export function sitemapPages(): readonly PublicPage[] {
    return PUBLIC_PAGE_LIST.filter((page) => page.indexable);
}
