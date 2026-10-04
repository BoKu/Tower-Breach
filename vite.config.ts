import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset URLs: works from the web server and from the desktop app (desktop/main.cjs)
  server: {
    port: 5173,
    // Dev: proxy multiplayer websocket to the relay (npm run relay).
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
