/**
 * Build-time static prerenderer.
 *
 * Vite emits a single dist/index.html. This script renders every public route
 * to static HTML with its own <head>, so crawlers, link unfurlers, and no-JS
 * visitors get the right title, description, canonical, Open Graph tags,
 * JSON-LD, and visible content before React loads.
 *
 * It also emits private shells (noindex) and a real 404 document, plus a
 * sitemap generated from the same route registry the UI uses.
 *
 * Run with: vite-node scripts/prerender.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LandingPage } from '../src/components/Landing/LandingPage';
import { FeaturesPage } from '../src/components/Public/FeaturesPage';
import { DocsPage } from '../src/components/Public/DocsPage';
import { FaqPage } from '../src/components/Public/FaqPage';
import { ContactPage } from '../src/components/Public/ContactPage';
import { NotFoundPage } from '../src/components/Public/NotFoundPage';
import { LegalPage } from '../src/components/Legal/LegalPage';

import {
  PRIVATE_PAGES,
  PUBLIC_PAGES,
  SITE,
  sitemapPages,
} from '../src/seo/site';
import {
  renderNotFoundHead,
  renderPrivateHead,
  renderPublicHead,
  SEO_BLOCK_END,
  SEO_BLOCK_START,
} from '../src/seo/head';

const DIST = new URL('../dist/', import.meta.url);

const PUBLIC_COMPONENTS = {
  home: () =>
    createElement(LandingPage, { onNavigateToApp: () => {}, onSignIn: () => {} }),
  features: () => createElement(FeaturesPage),
  docs: () => createElement(DocsPage),
  faq: () => createElement(FaqPage),
  contact: () => createElement(ContactPage),
  privacy: () => createElement(LegalPage, { path: '/privacy' }),
  terms: () => createElement(LegalPage, { path: '/terms' }),
};

function stripLeadingPreloads(markup) {
  // React 19 can hoist an image preload ahead of the markup. It belongs in the
  // head, not inside #root, and none of our public images need it.
  return markup.replace(/^(?:<link\b[^>]*\brel="preload"[^>]*\/?>\s*)+/i, '');
}

function replaceSeoBlock(template, head) {
  const start = template.indexOf(SEO_BLOCK_START);
  const end = template.indexOf(SEO_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('SEO markers are missing from dist/index.html');
  }
  return template.slice(0, start) + head + template.slice(end + SEO_BLOCK_END.length);
}

function setHtmlClass(template, className) {
  const withClass = className
    ? `<html lang="en" class="${className}">`
    : '<html lang="en">';
  if (!template.includes('<html lang="en">')) {
    throw new Error('Expected <html lang="en"> in dist/index.html');
  }
  return template.replace('<html lang="en">', withClass);
}

function replaceRoot(template, markup) {
  const root = '<div id="root"></div>';
  if (!template.includes(root)) {
    throw new Error('Expected an empty #root in dist/index.html');
  }
  return template.replace(root, `<div id="root">${markup}</div>`);
}

function buildPage(template, { head, markup, htmlClass, client = true }) {
  let html = replaceSeoBlock(template, head);
  html = setHtmlClass(html, htmlClass);
  html = replaceRoot(html, markup);
  if (!client) html = stripClientBootstrap(html);
  return html;
}

/**
 * Content documents are complete without React: navigation, FAQ disclosures,
 * anchors, and email links all work as plain HTML. Removing the entry module
 * means a direct visit downloads no application JavaScript at all.
 */
function stripClientBootstrap(html) {
  return html
    .replace(/<script\b[^>]*\btype="module"[^>]*><\/script>\s*/gi, '')
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/gi, '');
}

function privateBootMarkup(label) {
  return [
    '<div style="display:flex;min-height:100vh;align-items:center;justify-content:center;background:#080F1C;color:#E6EDF8;font-family:Inter,system-ui,sans-serif">',
    '<div style="display:flex;flex-direction:column;align-items:center;gap:14px">',
    '<img src="/img/azemax-mark-64.png" alt="" width="40" height="40" />',
    `<p style="margin:0;font-size:13px;font-weight:600">${label}</p>`,
    '</div></div>',
  ].join('');
}

function sitemapXml() {
  const urls = sitemapPages()
    .map(
      (page) =>
        `  <url>\n    <loc>${page.path === '/' ? SITE.url : `${SITE.origin}${page.path}`}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function writeDist(file, contents) {
  const target = new URL(file, DIST);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, contents);
}

async function main() {
  const template = await readFile(new URL('index.html', DIST), 'utf8');

  const written = [];

  // Public pages. The home page is emitted as index.html; the rest are flat
  // files that Vercel's cleanUrls serves at their extensionless paths.
  for (const page of Object.values(PUBLIC_PAGES)) {
    const render = PUBLIC_COMPONENTS[page.key];
    if (!render) throw new Error(`No prerender component registered for ${page.key}`);

    const markup = stripLeadingPreloads(renderToStaticMarkup(render()));
    const html = buildPage(template, {
      head: renderPublicHead(page),
      markup,
      htmlClass: page.key === 'home' ? 'az-landing-active' : 'az-doc-active',
      client: page.key === 'home',
    });

    const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`;
    await writeDist(file, html);
    written.push({ file, bytes: Buffer.byteLength(html) });
  }

  // Private shells: correct noindex head, no canonical, and a boot panel that
  // React replaces with the auth/workspace surface.
  for (const page of PRIVATE_PAGES) {
    const label =
      page.surface === 'app' ? 'Loading workspace…' : 'Loading sign in…';
    const html = buildPage(template, {
      head: renderPrivateHead(page),
      markup: privateBootMarkup(label),
      htmlClass: '',
    });
    const file = `${page.path.slice(1)}.html`;
    await writeDist(file, html);
    written.push({ file, bytes: Buffer.byteLength(html) });
  }

  // Real 404 document. Vercel serves this with a 404 status for unmatched paths.
  const notFoundHtml = buildPage(template, {
    head: renderNotFoundHead(),
    markup: stripLeadingPreloads(renderToStaticMarkup(createElement(NotFoundPage))),
    htmlClass: 'az-doc-active',
    client: false,
  });
  await writeDist('404.html', notFoundHtml);
  written.push({ file: '404.html', bytes: Buffer.byteLength(notFoundHtml) });

  // Sitemap generated from the same registry the pages use.
  const sitemap = sitemapXml();
  await writeDist('sitemap.xml', sitemap);
  written.push({ file: 'sitemap.xml', bytes: Buffer.byteLength(sitemap) });

  for (const item of written) {
    console.log(`  prerendered ${item.file} (${(item.bytes / 1024).toFixed(1)} KiB)`);
  }
  console.log(`[prerender] wrote ${written.length} files`);
}

try {
  await main();
} catch (error) {
  console.error('[prerender] failed');
  console.error(error);
  process.exitCode = 1;
}
