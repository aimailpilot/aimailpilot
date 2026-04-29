import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live under tests/ — keeps them out of server/ and client/ which esbuild/vite bundle.
    include: ['tests/**/*.test.ts'],
    // Pure unit tests only — no DOM, no DB, no live network calls.
    environment: 'node',
    // Fail fast on a single test failure during CI.
    bail: 0,
    // Reasonable defaults; override with --reporter=verbose if needed.
    reporters: ['default'],
    // Don't watch files in dist/ or node_modules.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
