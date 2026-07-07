/// <reference types="vite/client" />
import type { ClaudeTotalRecallApi } from '../main/preload'

declare global {
  interface Window {
    claudeTotalRecall: ClaudeTotalRecallApi
  }
}

export {}
