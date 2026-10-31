import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

// https://vite.dev/config/
function clientEnvGuard() {
  return {
    name: 'azemax-client-env-guard',
    config(_config: unknown, { command, mode }: { command: string; mode: string }) {
      if (command !== 'build') return;
      // Vite inlines the ENTIRE `import.meta.env` object whenever the browser
      // references a key that is absent at build time. That object includes the
      // names (and, without blanking, the values) of server-only provider
      // variables. Define every key the client reads with an explicit fallback
      // so Vite never needs the full object.
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const value = (key: string, fallback = '') => JSON.stringify(env[key] ?? fallback);

      const hasViteKeys = !!(env.VITE_GROQ_API_KEY || env.VITE_OPENROUTER_API_KEY || env.VITE_HF_TOKEN || env.VITE_KILO_API_KEY);
      if (hasViteKeys) {
        console.warn('\n⚠️  [azemax] VITE_ provider keys detected — not embedding them in the bundle (backend/BYOK holds credentials).');
      }
      if (env.VITE_USE_BACKEND_AI === 'false') {
        console.warn('\n⚠️  [azemax] VITE_USE_BACKEND_AI=false is a dev-server-only mode; shipped builds do not embed provider keys and must use the backend or BYOK.');
      }
      // Defense in depth: remove provider credentials from process.env so
      // Vite's environment object cannot pick them up either. Direct-provider
      // access is a dev-server-only fallback; shipped builds have
      // `import.meta.env.DEV === false`, so blanking these does not remove a
      // supported production path.
      delete process.env.VITE_GROQ_API_KEY;
      delete process.env.VITE_OPENROUTER_API_KEY;
      delete process.env.VITE_HF_TOKEN;
      delete process.env.VITE_KILO_API_KEY;

      const blank = JSON.stringify('');
      return {
        define: {
          'import.meta.env.VITE_API_URL': value('VITE_API_URL', '/api'),
          'import.meta.env.VITE_USE_BACKEND_AI': value('VITE_USE_BACKEND_AI', 'true'),
          'import.meta.env.VITE_WS_URL': value('VITE_WS_URL'),
          'import.meta.env.VITE_WS_PORT': value('VITE_WS_PORT', '3001'),
          'import.meta.env.VITE_FIREBASE_API_KEY': value('VITE_FIREBASE_API_KEY'),
          'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': value('VITE_FIREBASE_AUTH_DOMAIN'),
          'import.meta.env.VITE_FIREBASE_PROJECT_ID': value('VITE_FIREBASE_PROJECT_ID'),
          'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': value('VITE_FIREBASE_STORAGE_BUCKET'),
          'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': value('VITE_FIREBASE_MESSAGING_SENDER_ID'),
          'import.meta.env.VITE_FIREBASE_APP_ID': value('VITE_FIREBASE_APP_ID'),
          'import.meta.env.VITE_GROQ_API_KEY': blank,
          'import.meta.env.VITE_OPENROUTER_API_KEY': blank,
          'import.meta.env.VITE_HF_TOKEN': blank,
          'import.meta.env.VITE_KILO_API_KEY': blank,
          'import.meta.env.VITE_HF_BASE_URL': blank,
        },
      };
    },
  };
}

function validateApiUrl() {
  return {
    name: 'azemax-validate-api-url',
    configResolved(config: { command: string; mode: string }) {
      if (config.command !== 'build' || config.mode !== 'production') return;
      const apiUrl = process.env.VITE_API_URL;
      if (!apiUrl) {
        console.warn('\n⚠️ [azemax] VITE_API_URL is not set. The build will use the fallback "/api" which works for local development via Vite proxy. For production deployment, set VITE_API_URL to your backend URL ending in /api (e.g. https://azemax-backend-vzox.onrender.com/api).');
        return;
      }
      if (!/^https?:\/\/.*\/api$/i.test(apiUrl)) {
        console.warn('\n⚠️ [azemax] VITE_API_URL should be an absolute URL ending in "/api" for production deployment.');
        console.warn(`   Current value: "${apiUrl}"`);
        console.warn('   Example: https://azemax-backend-vzox.onrender.com/api');
        console.warn('   In Vercel: Project Settings → Environment Variables → Edit VITE_API_URL for Production\n');
        return;
      }
      console.log(`\n✅ [azemax] VITE_API_URL validated: ${apiUrl}\n`);
    },
  };
}

/**
 * Generates public/indexnow-key.txt during production builds so Vercel can
 * serve it for Bing IndexNow domain verification.
 *
 * Security:
 *  - Reads INDEXNOW_API_KEY from process.env (server-side only, NOT VITE_
 *    prefixed), so it is never inlined into client-side JavaScript.
 *  - Never logs the key value.
 *  - Fails the production build clearly if the key is missing.
 *  - The file is written to public/ and copied to dist/ by Vite's public
 *    assets copy; it is gitignored and never committed.
 */
function indexnowKeyFilePlugin() {
  let isProductionBuild = false;
  return {
    name: 'azemax-indexnow-keyfile',
    configResolved(config: { command: string; mode: string }) {
      isProductionBuild = config.command === 'build' && config.mode === 'production';
    },
    async buildStart() {
      if (!isProductionBuild) return;

      const apiKey = process.env.INDEXNOW_API_KEY;
      if (!apiKey) {
        throw new Error(
          '\n[azemax] INDEXNOW_API_KEY is not set in the production build environment.\n' +
          '  Obtain a key from https://www.bing.com/webmasters\n' +
          '  Set it in Vercel: Project Settings → Environment Variables → INDEXNOW_API_KEY\n' +
          '  Or locally: INDEXNOW_API_KEY=<key> npm run build\n'
        );
      }

      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const keyFile = path.resolve(process.cwd(), 'public/indexnow-key.txt');

      // Overwrite on every production build so the deployed key always matches.
      await fs.writeFile(keyFile, apiKey);

      console.log('\n✅ [azemax] IndexNow key file generated for production build.\n');
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    clientEnvGuard(),
    validateApiUrl(),
    indexnowKeyFilePlugin(),
    ...(process.env.ANALYZE ? [visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    })] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Content-Encoding', 'identity');
            }
          });
          proxy.on('error', (err) => {
            console.error('[vite proxy] /api error:', err.message);
          });
        },
      },
    },
    hmr: {
      overlay: true,
    },
  },
  preview: {
    // Let a local production preview exercise the app against the local API
    // instead of serving index.html for /api requests.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Group dependencies by resolved module path. A module-keyed object
        // (`manualChunks: { 'vendor-react': ['react'] }`) leaves transitive
        // entries such as react/jsx-runtime unassigned; Rollup can then fold
        // the JSX runtime into an unrelated manual chunk. That made the landing
        // page download framer-motion (and then react-markdown) eagerly just
        // to render static JSX. Path matching keeps every React runtime file in
        // one chunk that the landing page already needs.
        manualChunks(id: string) {
          const modulePath = id.replace(/\\/g, '/');
          if (!modulePath.includes('/node_modules/')) return undefined;

          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(modulePath)) {
            return 'vendor-react';
          }
          if (
            modulePath.includes('/node_modules/@monaco-editor/') ||
            modulePath.includes('/node_modules/monaco-editor/')
          ) {
            return 'vendor-monaco';
          }
          if (modulePath.includes('/node_modules/@xterm/')) {
            return 'vendor-terminal';
          }
          if (
            modulePath.includes('/node_modules/framer-motion/') ||
            modulePath.includes('/node_modules/motion-dom/') ||
            modulePath.includes('/node_modules/motion-utils/')
          ) {
            return 'vendor-motion';
          }
          // Do not force icon libraries into a shared manual chunk. The landing
          // imports a handful of icons; grouping every icon used anywhere in
          // the app would make that entire set part of the initial download.
          if (
            modulePath.includes('/node_modules/react-markdown/') ||
            modulePath.includes('/node_modules/remark-') ||
            modulePath.includes('/node_modules/prismjs/') ||
            modulePath.includes('/node_modules/rehype-') ||
            modulePath.includes('/node_modules/unified/') ||
            modulePath.includes('/node_modules/mdast-') ||
            modulePath.includes('/node_modules/hast-') ||
            modulePath.includes('/node_modules/micromark')
          ) {
            return 'vendor-markdown';
          }
          if (
            modulePath.includes('/node_modules/clsx/') ||
            modulePath.includes('/node_modules/tailwind-merge/')
          ) {
            return 'vendor-utils';
          }
          return undefined;
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const info = (assetInfo.name ?? '').split('.');
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash].${ext}`;
          }
          if (/css/i.test(ext)) {
            return `assets/css/[name]-[hash].${ext}`;
          }
          return `assets/[ext]/[name]-[hash].${ext}`;
        },
      },
    },
    chunkSizeWarningLimit: 600,
    cssCodeSplit: true,
    reportCompressedSize: true,
    minify: 'esbuild',
    target: 'esnext',
    sourcemap: process.env.NODE_ENV === 'production' ? false : true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@monaco-editor/react'],
  },
  esbuild: {
    treeShaking: true,
    pure: ['console.log', 'console.debug'],
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
  },
})
