import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve `@ljkt/storage` self-imports and the `@ljkt/dsl` dependency to
// their package sources, so `pnpm test` is standalone on a clean checkout (no
// `dist` build required). Consumers still resolve via each package's `exports`
// map → `dist` as before.
export default defineConfig({
  resolve: {
    alias: {
      '@ljkt/storage': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@ljkt/dsl': fileURLToPath(new URL('../dsl/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Node env + explicit shims (test/setup.ts) for the few browser globals the
    // backends touch (IndexedDB, URL.createObjectURL, crypto.subtle). The
    // backends take their `Storage` / `IDBFactory` by injection, so tests pass
    // fresh isolated instances rather than leaning on ambient globals.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
