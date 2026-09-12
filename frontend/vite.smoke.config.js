// Temporary config for the render-smoke check; not part of the app build.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { ssr: 'smoke.jsx', outDir: '.smoke', emptyOutDir: true },
  ssr: { noExternal: true },
});
