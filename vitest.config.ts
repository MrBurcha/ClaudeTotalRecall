import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@platform': resolve('src/platform'),
    },
  },
  test: {
    globals: true,
    // The core is pure TS and runs under Node (the default). React component tests
    // (*.test.tsx) opt into a browser-like DOM with a `@vitest-environment happy-dom`
    // docblock at the top of each file. (vitest 4 removed `environmentMatchGlobs`;
    // per-file docblocks are the supported replacement for our 3 component tests.)
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Electron main process needs a running Electron, not unit-tested here.
        'src/main/**',
        // App entrypoints / type-only / styles.
        'src/renderer/main.tsx',
        'src/**/*.d.ts',
      ],
      thresholds: {
        // Guard the pure core (the risky logic) against coverage regressions.
        // Current: ~93% lines/functions, ~89% branches — headroom below that.
        'src/core/**': { lines: 85, functions: 85, statements: 85, branches: 80 },
      },
    },
  },
})
