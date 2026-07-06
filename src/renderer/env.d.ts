/// <reference types="vite/client" />
import type { ClaudeTrApi } from '../main/preload'

declare global {
  interface Window {
    claudetr: ClaudeTrApi
  }
}

export {}
