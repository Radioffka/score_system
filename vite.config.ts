import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Generate assets with explicit non-inline paths
    assetsInlineLimit: 0,
    // By removing the rollupOptions.output configuration,
    // we allow Vite to use its default behavior, which includes
    // adding a hash to the filenames for cache busting.
    // This is the key fix for the caching issue.
  },
  // Base path needs to be relative for iframe hosting
  base: './',
});