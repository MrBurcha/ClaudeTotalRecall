import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import i18n from './i18n'
import { readStoredTheme } from './state/store'
import './theme/index.css'

// Apply theme and language before the first render (avoids flash). Theme defaults to
// dark; the language is resolved synchronously by the i18n module on import.
document.documentElement.dataset.theme = readStoredTheme()
document.documentElement.lang = i18n.language

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
