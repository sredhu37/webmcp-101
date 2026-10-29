import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { webDist, webRoot } from './server/paths.ts';

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: webDist,
    emptyOutDir: true,
    // Monaco is one lazily loaded chunk of about 3 MB, served from localhost.
    chunkSizeWarningLimit: 4000,
  },
});
