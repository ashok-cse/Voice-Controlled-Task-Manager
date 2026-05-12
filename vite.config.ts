import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const BACKEND_PORT = process.env.BACKEND_PORT ?? '8787';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
        rewriteWsOrigin: true
      }
    }
  }
});
