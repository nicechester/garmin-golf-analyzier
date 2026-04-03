import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: {
    port: 9002,
    strictPort: true,
    host: 'localhost',
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: './web/index.html' }
    }
  },
  clearScreen: false,
});
