/// <reference types="vitest/config" />
import { realpathSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Canonical on-disk path, so files reached through junctions or virtualised folders get one module id.
const here = realpathSync.native(import.meta.dirname);
const API = process.env.WAYLO_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(here, 'src'),
      // Resolve the workspace package from source directly (no symlink dependence).
      '@waylo/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(here, '../..')] },
    proxy: { '/api': { target: API, changeOrigin: false }, '/health': API },
  },
  preview: { port: 4173, proxy: { '/api': API } },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/@radix-ui')) return 'radix';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
