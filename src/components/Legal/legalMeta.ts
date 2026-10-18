/**
 * Shared legal metadata and types — kept separate from the (large) legal
 * document prose in `legalContent.ts`.
 *
 * Why the split: the site footer and the auth surfaces need only the route
 * paths and the support email, while the long Privacy Policy / Terms prose is
 * needed only by the lazy `LegalPage`. Importing the prose from those small
 * consumers would pull ~30 KB of legal text into the initial bundle, so the
 * constants live here and the prose stays in its own module.
 */

export const LEGAL = {
    /** Product / operator name as displayed. Not a registered corporate entity. */
    operator: 'Azemax Studio',
    product: 'Azemax Studio',
    website: 'https://www.azemax.com',
    supportEmail: 'azemaxhq@gmail.com',
    effectiveDate: 'October 18, 2026',
    lastUpdated: 'October 18, 2026',
    version: '1.0',
} as const;

/** Same-origin paths used for in-app (SPA) links. */
export const LEGAL_PATHS = {
    privacy: '/privacy',
    terms: '/terms',
} as const;

/** Canonical absolute URLs used inside the document text. */
export const LEGAL_ABSOLUTE = {
    privacy: `${LEGAL.website}/privacy`,
    terms: `${LEGAL.website}/terms`,
} as const;

export type LegalBullet = { term?: string; text: string };

export type LegalBlock =
    | { kind: 'p'; text: string }
    | { kind: 'list'; ordered?: boolean; items: (string | LegalBullet)[] }
    | { kind: 'note'; text: string; tone?: 'info' | 'warn' };

export interface LegalSection {
    /** Anchor id (kebab-case, unique within the document). */
    id: string;
    title: string;
    blocks: LegalBlock[];
}

export interface LegalDocument {
    kind: 'privacy' | 'terms';
    eyebrow: string;
    title: string;
    /** One-paragraph plain-language summary shown under the title. */
    intro: string;
    effectiveDate: string;
    lastUpdated: string;
    version: string;
    sections: LegalSection[];
}
