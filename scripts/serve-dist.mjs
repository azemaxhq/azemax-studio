/**
 * Local static server that mirrors Vercel's clean-URL behavior:
 *   /features        -> dist/features.html
 *   /features/       -> 308 redirect to /features
 *   /app/*           -> dist/app.html (mirrors the Vercel rewrite)
 *   /unknown         -> dist/404.html with a real 404 status
 *
 * This exists so local checks (Lighthouse, curl, link crawls) exercise the
 * prerendered documents instead of Vite's SPA fallback.
 *
 * Run with: node scripts/serve-dist.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT || 4174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  return join(DIST, rel);
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolve(pathname) {
  if (pathname === '/') return join(DIST, 'index.html');

  const base = safePath(pathname);
  if (!base) return null;

  if (extname(base)) {
    return (await isFile(base)) ? base : null;
  }

  const asHtml = `${base}.html`;
  if (await isFile(asHtml)) return asHtml;

  const asIndex = join(base, 'index.html');
  if (await isFile(asIndex)) return asIndex;

  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // trailingSlash: false
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      res.writeHead(308, { Location: `${url.pathname.replace(/\/+$/, '')}${url.search}` });
      res.end();
      return;
    }

    // Mirrors the narrow Vercel rewrites. Do not add a catch-all: unknown
    // paths must exercise the real 404 document, not the SPA shell.
    const pathname =
      url.pathname === '/app' || url.pathname.startsWith('/app/')
        ? '/app'
        : url.pathname;

    const file = await resolve(pathname);
    const target = file ?? join(DIST, '404.html');
    let body = await readFile(target);
    const ext = extname(target);
    const type = MIME[ext] || 'application/octet-stream';
    const compressible = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg)/.test(type);
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const headers = {
      'Content-Type': type,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
    };

    if (
      url.pathname === '/app' ||
      url.pathname.startsWith('/app/') ||
      ['/login', '/signup', '/forgot-password', '/verify-email', '/auth/callback'].includes(url.pathname)
    ) {
      headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive';
    }

    if (compressible && acceptsGzip && body.length > 1024) {
      body = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }

    headers['Content-Length'] = body.length;
    res.writeHead(file ? 200 : 404, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving dist at http://127.0.0.1:${PORT}`);
});
