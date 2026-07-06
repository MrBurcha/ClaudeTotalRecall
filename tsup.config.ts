import { defineConfig } from 'tsup'

// The CLI is a thin Node binary that imports the pure `core` — no Electron.
export default defineConfig({
  entry: { index: 'src/cli/index.ts' },
  outDir: 'dist-cli',
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
})
