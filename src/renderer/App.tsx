import { AppShell } from './screens/AppShell'
import { AppStateProvider } from './state/store'

/** Composition root: provides the store and mounts the shell (sidebar + hosts). */
export function App(): JSX.Element {
  return (
    <AppStateProvider>
      <AppShell />
    </AppStateProvider>
  )
}
