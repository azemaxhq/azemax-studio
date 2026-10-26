/**
 * Single source of truth for Azemax product branding.
 *
 * The logo is served from /public rather than imported as a module so it is
 * never duplicated into the JS bundle and never emits a React image preload
 * ahead of the HTML head.
 */
export const BRAND = {
  name: 'Azemax',
  version: '1.0.0-beta',
  tagline: 'Build beyond limits.',
  logoSrc: '/img/azemax-mark-128.png',
  logoPublicPath: '/img/azemax-mark-128.png',
  website: 'https://www.azemax.com',
} as const;

export const PRODUCT_NAME = BRAND.name;
