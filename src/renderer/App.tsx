import { AppShell } from './screens/AppShell'
import { AppStateProvider } from './state/store'

/** Raíz de composición: provee el store y monta el shell (sidebar + hosts). */
export function App(): JSX.Element {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  )
}
