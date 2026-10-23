import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'));
const BUILD_META = { version: pkg.version as string, buildDate: Date.now() };

/** Emits /meta.json and exposes the same object to the bundle (VersionChecker contract). */
function buildMeta(): Plugin {
  return {
    name: 'build-meta',
    config: () => ({ define: { __BUILD_META__: JSON.stringify(BUILD_META) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'meta.json', source: JSON.stringify(BUILD_META, null, 2) });
    },
    configureServer(server) {
      server.middlewares.use('/meta.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(BUILD_META));
      });
    },
  };
}

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5000';
// Everything the backend owns. Paths with spaces are matched by their decoded form.
const PROXIED = [
  '/api', '/Metadata', '/JSON Murabba', '/JSON%20Murabba', '/Shajra Parcha', '/Shajra%20Parcha',
  '/pmtiles', '/tiles', '/demo-access', '/stats', '/online-users', '/multi-device-users',
  '/subscription-stats', '/user-ip-history', '/user-locations', '/location-heatmap', '/location-stats', '/health',
];

export default defineConfig({
  plugins: [react(), tailwindcss(), buildMeta()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 3000,
    proxy: {
      ...Object.fromEntries(
        PROXIED.map((p) => [
          p,
          {
            target: BACKEND,
            changeOrigin: true,
            // Browser navigations to SPA pages that share a prefix with an API route (/stats) get index.html
            bypass: (req: any) =>
              req.url?.split('?')[0] === '/stats' && req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
          },
        ]),
      ),
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, '..', process.env.OUT_DIR || 'build'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
