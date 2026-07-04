import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Prefer TypeScript sources over any stale compiled .js siblings so source
    // edits always take effect (guards against the tsc-emit-into-src footgun).
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.jsx', '.js', '.json'],
  },
  server: {
    port: 1002,
    strictPort: true,
    host: true,
    proxy: {
      // Forward API calls to the backend server (port 1003)
      '/profile': 'http://localhost:1003',
      '/snapshots': 'http://localhost:1003',
      '/invites': 'http://localhost:1003',
      '/push': 'http://localhost:1003',
      '/admin': 'http://localhost:1003',
      '/ws': { target: 'ws://localhost:1003', ws: true },
    },
  },
  preview: {
    port: 1002,
    strictPort: true,
    host: true,
  },
  worker: {
    // Configure Web Worker bundling
    format: 'es',
  },
  build: {
    // Optimize chunk splitting for better caching and parallel loading
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks to separate cache-friendly bundles
          'vendor-react': ['react', 'react-dom'],
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/messaging'],

        },
      },
    },
    // Increase chunk size warnings threshold since Three.js adds size
    chunkSizeWarningLimit: 600,
    // Source maps for development debugging
    sourcemap: false,
    // Minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
});
