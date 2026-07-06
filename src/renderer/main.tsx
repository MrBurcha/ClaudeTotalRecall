import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { readStoredTheme } from './state/store'
import './theme/index.css'

// Aplica el tema antes del primer render (evita flash). El default es dark.
document.documentElement.dataset.theme = readStoredTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
