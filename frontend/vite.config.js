import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy in dev so the browser and API share an origin and the session
    // cookie needs no cross-site handling locally. In production the two are on
    // different hosts, which is why the API sets SameSite=None; Secure.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        /**
         * Split the chart library out of the entry bundle.
         *
         * Recharts plus its d3 dependencies is the largest single thing here
         * and only the dashboard needs it, so in one bundle it made the landing
         * page and the sign-in screen pay for a chart they never draw. It is
         * loaded lazily where it is used, and pinned to its own chunk here so
         * the split survives any future import from another screen.
         */
        manualChunks: {
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
