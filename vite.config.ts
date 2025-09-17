import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1002,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 1002,
    strictPort: true,
    host: true,
  },
});
