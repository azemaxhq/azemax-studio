import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

// https://vite.dev/config/
function productionSecretGuard() {
  return {
    name: 'azemax-prod-secret-guard',
    config(_config: unknown, { command }: { command: string }) {
      if (command !== 'build') return;
      const rawBackend = process.env.VITE_USE_BACKEND_AI;
      const backendAI = rawBackend === undefined ? 'true' : rawBackend;
      if (backendAI === 'false') return;
      // Strip provider keys from the Vite define/env so they are never inlined into dist/
      // even if .env contains them.  Vite reads .env into process.env AND into its
      // internal `env` object — we blank both.  The blanking is done via `define`
      // override which wins over Vite's env injection.
      const hasViteKeys = !!(process.env.VITE_GROQ_API_KEY || process.env.VITE_OPENROUTER_API_KEY || process.env.VITE_HF_TOKEN || process.env.VITE_KILO_API_KEY);
      if (hasViteKeys) {
        console.warn('\n⚠️  [azemax] VITE_ provider keys detected — blanking for production bundle (backend holds keys).');
      }
      delete process.env.VITE_GROQ_API_KEY;
      delete process.env.VITE_OPENROUTER_API_KEY;
      delete process.env.VITE_HF_TOKEN;
      delete process.env.VITE_KILO_API_KEY;
      // Force Vite's define to blank them even if .env is re-loaded internally
      const blank = JSON.stringify('');
      return {
        define: {
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

export default defineConfig({
  plugins: [
    react(),
    productionSecretGuard(),
    validateApiUrl(),
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
