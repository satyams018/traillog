/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_* variables from the repo-root .env shared with Django.
  envDir: '..',
  server: {
    port: 5173,
    // Same-origin in dev: the browser only talks to Vite, which forwards API calls (ADR-3).
    proxy: {
      '/api': backend,
      '/_allauth': backend,
      '/admin': backend,
      '/static': backend,
    },
  },
  // MapLibre v6 loads its web worker relative to its own module URL. Pre-bundling moves the
  // module into .vite/deps and breaks that path, so serve it as-is in dev.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // MapLibre's worker is an ES module, so bundle workers as ES modules too.
  worker: { format: 'es' },
  build: {
    // MapLibre alone is ~290 kB gzipped; it is lazy-loaded only on map pages.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('maplibre-gl') ? 'maplibre' : undefined),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
