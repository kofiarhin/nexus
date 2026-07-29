import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  },
  server: { port: 5173 }
});
