import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
    // Same-origin in development: the browser only ever talks to :3101.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 3101,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
