import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: Number(process.env.PHIGUESS_PREVIEW_PORT || 5174), strictPort: true,
    proxy: {
      '/api': { target: process.env.API_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
      '/socket.io': { target: process.env.API_TARGET || 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
