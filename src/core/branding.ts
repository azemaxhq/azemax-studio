import azemaxLogoSrc from '../assets/azemax_logo_wbg.png';

/**
 * Single source of truth for Azemax product branding.
 */
export const BRAND = {
  name: 'Azemax',
  version: '1.0.0',
  tagline: 'Fast, intelligent developer environment',
  logoSrc: azemaxLogoSrc,
  logoPublicPath: '/img/azemax_logo_wbg.png',
  website: 'https://azemax.dev',
} as const;

export const PRODUCT_NAME = BRAND.name;
