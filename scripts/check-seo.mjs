/**
 * Post-build SEO artifact checker.
 *
 * Fails the check if a public page is missing a unique title, description,
 * canonical, robots directive, or JSON-LD graph; if the sitemap and the
 * rendered pages disagree; or if a private/404 document is indexable.
 *
 * Run with: npm run check:seo   (after npm run build)
 */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGE_LIST, PRIVATE_PAGES, SITE } from '../src/seo/site.ts';

const DIST = new URL('../dist/', import.meta.url);
const errors = [];
const warnings = [];
let checks = 0;

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function check(condition, message) {
  checks += 1;
  if (!condition) fail(message);
}

async function readDist(file) {
  return readFile(new URL(file, DIST), 'utf8');
}

async function exists(file) {
  try {
    return (await stat(new URL(file, DIST))).isFile();
  } catch {
    return false;
  }
}

function match(html, regex) {
  return html.match(regex)?.[1] ?? null;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  return blocks;
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const titles = new Map();
const canonicals = new Map();

for (const page of PUBLIC_PAGE_LIST) {
  const file = page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`;
  check(await exists(file), `missing prerendered file ${file}`);

  const html = await readDist(file);
  const title = decodeEntities(match(html, /<title>([^<]+)<\/title>/) ?? '');
  const description = decodeEntities(match(html, /<meta name="description" content="([^"]*)"/) ?? '');
  const canonical = match(html, /<link rel="canonical" href="([^"]*)"/);
  const robots = match(html, /<meta name="robots" content="([^"]*)"/);
  const ogImage = match(html, /<meta property="og:image" content="([^"]*)"/);
  const ogWidth = match(html, /<meta property="og:image:width" content="([^"]*)"/);
  const ogHeight = match(html, /<meta property="og:image:height" content="([^"]*)"/);
  const rootStart = html.indexOf('<div id="root">');
  const rootEnd = html.lastIndexOf('</div>');
  const rootLength = rootStart === -1 || rootEnd <= rootStart ? 0 : rootEnd - rootStart;
  const h1Count = (html.match(/<h1[\s>]/g) || []).length;

  check(title.length > 10, `${file}: missing or short <title>`);
  check(title === page.title, `${file}: title does not match the route registry`);
  check(description.length > 50, `${file}: missing or short meta description`);
  check(description === page.description, `${file}: description does not match the route registry`);
  check(canonical === (page.path === '/' ? SITE.url : `${SITE.origin}${page.path}`), `${file}: wrong canonical (${canonical})`);
  check(robots?.includes('index') && robots?.includes('follow'), `${file}: public page is not index,follow`);
  check(ogImage === `${SITE.origin}${SITE.ogImagePath}`, `${file}: wrong og:image (${ogImage})`);
  check(ogWidth === String(SITE.ogImageWidth) && ogHeight === String(SITE.ogImageHeight), `${file}: wrong og:image dimensions`);
  check(rootLength > 2000, `${file}: #root has no prerendered content`);
  if (page.key === 'home') {
    check(html.includes('<script type="module"'), `${file}: missing the entry module script`);
  } else {
    check(!html.includes('<script type="module"'), `${file}: content page should not ship the application script`);
    check(!html.includes('rel="modulepreload"'), `${file}: content page should not preload application chunks`);
  }
  check(h1Count === 1, `${file}: expected exactly one <h1>, found ${h1Count}`);
  check(html.includes('<html lang="en" class="az-doc-active">') || (page.key === 'home' && html.includes('<html lang="en" class="az-landing-active">')), `${file}: wrong <html> class`);

  // The document must contain real, readable content before scripts run.
  // Strip metadata, styles, and markup, then require a meaningful word count.
  const visibleText = decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  check(visibleText.split(' ').length >= 200, `${file}: too little prerendered text (${visibleText.split(' ').length} words)`);

  if (page.key === 'home') {
    // The static overview gives crawlers and no-JS visitors a factual product
    // summary and real links before the lazy below-fold sections mount.
    check(html.includes('id="overview"'), `${file}: missing static product overview`);
    check(html.includes('A real editor.'), `${file}: product overview heading is missing`);
    for (const href of ['/features', '/docs', '/faq']) {
      check(html.includes(`href="${href}"`), `${file}: product overview is missing a link to ${href}`);
    }
  }

  check(!titles.has(title), `${file}: duplicate title also used by ${titles.get(title)}`);
  titles.set(title, file);

  if (canonical) {
    check(!canonicals.has(canonical), `${file}: duplicate canonical also used by ${canonicals.get(canonical)}`);
    canonicals.set(canonical, file);
  }

  // JSON-LD must parse and contain the shared entities plus this page.
  const blocks = jsonLdBlocks(html);
  check(blocks.length === 1, `${file}: expected exactly one JSON-LD block, found ${blocks.length}`);
  if (blocks[0]) {
    try {
      const data = JSON.parse(blocks[0]);
      const types = (data['@graph'] || []).map((node) => node['@type']);
      check(types.includes('WebSite'), `${file}: JSON-LD missing WebSite`);
      check(types.includes('Organization'), `${file}: JSON-LD missing Organization`);
      check(types.includes('WebPage') || types.includes('ContactPage'), `${file}: JSON-LD missing page node`);
      if (page.path !== '/') check(types.includes('BreadcrumbList'), `${file}: JSON-LD missing BreadcrumbList`);
      if (page.key === 'faq') {
        check(types.includes('FAQPage'), `${file}: FAQ page missing FAQPage`);
        const faq = data['@graph'].find((node) => node['@type'] === 'FAQPage');
        check(faq?.mainEntity?.length >= 10, `${file}: FAQPage has too few questions`);
      }
      const org = data['@graph'].find((node) => node['@type'] === 'Organization');
      check(org?.founder?.url === SITE.founderUrl, `${file}: Organization founder URL is wrong`);
      const software = data['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
      if (software) {
        check(!software.offers, `${file}: SoftwareApplication must not claim an offer`);
        check(!software.aggregateRating, `${file}: SoftwareApplication must not claim a rating`);
      }
    } catch (error) {
      fail(`${file}: invalid JSON-LD (${error.message})`);
    }
  }

  // No local or placeholder hosts should leak into public HTML.
  check(!html.includes('http://localhost'), `${file}: contains a localhost URL`);
  check(!html.includes('127.0.0.1'), `${file}: contains a loopback URL`);
  check(!html.includes('example.com'), `${file}: contains a placeholder domain`);
}

// Private and 404 documents must never be indexable and must not carry a
// canonical pointing at a public page.
for (const page of PRIVATE_PAGES) {
  const file = `${page.path.slice(1)}.html`;
  check(await exists(file), `missing private shell ${file}`);
  const html = await readDist(file);
  const robots = match(html, /<meta name="robots" content="([^"]*)"/);
  check(robots?.includes('noindex'), `${file}: private shell is indexable`);
  check(!html.includes('rel="canonical"'), `${file}: private shell must not declare a canonical`);
  check(html.includes('<script type="module"'), `${file}: private shell is missing the application script`);
}

{
  const html = await readDist('404.html');
  const robots = match(html, /<meta name="robots" content="([^"]*)"/);
  check(robots?.includes('noindex'), '404.html is indexable');
  check(!html.includes('rel="canonical"'), '404.html must not declare a canonical');
  check(!html.includes('<script type="module"'), '404.html should not ship the application script');
}

// Sitemap must exactly match the public, indexable registry.
{
  check(await exists('sitemap.xml'), 'missing sitemap.xml');
  const sitemap = await readDist('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = PUBLIC_PAGE_LIST.filter((page) => page.indexable).map((page) =>
    page.path === '/' ? SITE.url : `${SITE.origin}${page.path}`,
  );
  check(locs.length === expected.length, `sitemap has ${locs.length} URLs, expected ${expected.length}`);
  for (const url of expected) check(locs.includes(url), `sitemap is missing ${url}`);
  for (const url of locs) check(expected.includes(url), `sitemap includes unexpected ${url}`);
  for (const page of PRIVATE_PAGES) {
    check(!sitemap.includes(`${SITE.origin}${page.path}<`), `sitemap includes private route ${page.path}`);
  }
}

// Social image and icons.
{
  const og = await readFile(new URL('img/azemax-studio-og.png', DIST));
  const size = pngSize(og);
  check(size?.width === 1200 && size?.height === 630, `og image is ${size?.width}x${size?.height}, expected 1200x630`);
  for (const icon of [
    'img/favicon-16.png',
    'img/favicon-32.png',
    'img/favicon-48.png',
    'img/favicon-96.png',
    'img/apple-touch-icon.png',
    'img/icon-192.png',
    'img/icon-512.png',
    'img/fevicon_large.png',
    'img/azemax-mark-64.png',
    'img/azemax-mark-128.png',
  ]) {
    check(await exists(icon), `missing icon ${icon}`);
  }
  const large = pngSize(await readFile(new URL('img/fevicon_large.png', DIST)));
  check(large?.width === 1254 && large?.height === 1254, `large favicon is ${large?.width}x${large?.height}, expected 1254x1254`);
}

// robots.txt must point at the canonical sitemap and block private surfaces.
{
  const robots = await readDist('robots.txt');
  check(robots.includes(`Sitemap: ${SITE.origin}/sitemap.xml`), 'robots.txt has the wrong sitemap URL');
  for (const path of ['/app', '/login', '/api/']) {
    check(robots.includes(`Disallow: ${path}`), `robots.txt does not disallow ${path}`);
  }
}

for (const message of warnings) console.warn(`  warning: ${message}`);

if (errors.length) {
  console.error(`\nSEO check failed (${errors.length} problems, ${checks} assertions):`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`SEO check passed (${checks} assertions across ${PUBLIC_PAGE_LIST.length} public pages).`);
