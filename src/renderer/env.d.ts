/// <reference types="vite/client" />
import type { EngramApi } from '../main/preload'

declare global {
  interface Window {
    engram: EngramApi
  }
}

export {}
