import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@core': resolve('src/core'),
  '@platform': resolve('src/platform'),
  // Brand/app-icon assets live under build/ (shared with packaging). The
  // renderer imports the app icon from here so the UI mark and the OS icon are
  // one source of truth.
  '@build': resolve('build'),
}

export default defineConfig({
  main: {
    // electron-vite v5 externalizes node deps by default (build.externalizeDeps),
    // so the former externalizeDepsPlugin() is no longer needed.
    resolve: { alias },
    build: {
      rollupOptions: { input: { main: resolve('src/main/main.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { preload: resolve('src/main/preload.ts') } },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react()],
    build: {
      // Never inline assets as data: URIs. The renderer's strict CSP
      // (default-src 'self', no data:) would block them; emit every asset as a
      // hashed file served from 'self' instead, so the brand icon (and any
      // future swap, of any size) loads.
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
})
