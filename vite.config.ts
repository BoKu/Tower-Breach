import { defineConfig, type Plugin } from 'vite';
import { readdirSync } from 'node:fs';

/** posters/index.json: every .jpg in public/posters (moddable wall posters; the desktop app re-reads the folder live). */
const posterNames = () => { try { return readdirSync('public/posters').filter((n) => /\.jpe?g$/i.test(n)).sort(); } catch { return []; } };
const posters = (): Plugin => ({
  name: 'poster-index',
  configureServer(s) { s.middlewares.use('/posters/index.json', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(posterNames())); }); },
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'posters/index.json', source: JSON.stringify(posterNames()) }); },
});

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [posters()],
  base: './', // relative asset URLs: works from the web server and from the desktop app (desktop/main.cjs)
  server: {
    port: 5173,
    // Dev: proxy multiplayer websocket to the relay (npm run relay).
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  // the SSR build is the dedicated server for `npm run server` (dist-server/): it serves dist/, no public/ copy
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, copyPublicDir: !isSsrBuild },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
