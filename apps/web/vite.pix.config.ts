import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5201,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3106', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3106', changeOrigin: true },
    },
  },
  resolve: {
    alias: { '@cantina/shared': '../../packages/shared/src/index.ts' },
  },
});
