import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import es from './es.json'

export type Locale = 'en' | 'es'
export const LOCALES: Locale[] = ['en', 'es']
const STORAGE_KEY = 'claude-total-recall:locale'

/**
 * Maps the host's preferred languages to a supported locale. Chromium exposes the
 * system locale synchronously via navigator.languages, so no main-process IPC is
 * needed and the first paint already has the right language (anti-flash).
 */
function detectFromHost(): Locale {
  const langs =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  for (const l of langs) {
    const lc = (l ?? '').toLowerCase()
    if (lc.startsWith('es')) return 'es'
    if (lc.startsWith('en')) return 'en'
  }
  return 'en'
}

/** Persisted choice wins; otherwise fall back to the host locale, then English. */
export function readStoredLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'es') return saved
  } catch {
    /* localStorage unavailable — fall through to host detection */
  }
  return detectFromHost()
}

// Synchronous init: resources are bundled and initAsync:false means t() works
// before the first render, so there is no flash of the wrong language.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: readStoredLocale(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'es'],
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false }, // React already escapes
  react: { useSuspense: false },
  initAsync: false,
})

// i18next is the single source of truth for the language; this listener keeps the
// <html lang> attribute and the persisted preference in sync on every change.
// Guarded for non-DOM contexts (e.g. node-based tests importing this module).
i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignore persistence failure (localStorage unavailable) */
  }
})

export default i18n
