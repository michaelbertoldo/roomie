import { defineConfig } from 'vite';

// Dev: the browser talks to Vite on :5173; /api (including /api/auth) is proxied to the local API
// server (npm run dev:api on :3001), which mirrors what Vercel does in production.
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
  build: { outDir: 'dist', sourcemap: false },
});
