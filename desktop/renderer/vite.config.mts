import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root: resolve(repositoryRoot, 'desktop/renderer'),
  base: '/desktop/',
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^@ljkt\/storage$/,
        replacement: resolve(repositoryRoot, 'desktop/renderer/storage-browser.ts'),
      },
      { find: '@', replacement: repositoryRoot },
    ],
  },
  css: { postcss: repositoryRoot },
  build: {
    outDir: resolve(repositoryRoot, 'public/desktop'),
    emptyOutDir: true,
    manifest: true,
  },
});
