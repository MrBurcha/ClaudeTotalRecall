import { useEffect } from 'react'
import { ToastHost } from '../components/ToastHost'
import { CommandPalette } from '../features/command-palette/CommandPalette'
import { OnboardingWizard } from '../features/wizard/OnboardingWizard'
import { canSync, conflicts, needsOnboarding } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { Machines } from './Machines'
import { ModalHost } from './ModalHost'
import { Projects } from './Projects'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { SyncHome } from './SyncHome'

export function AppShell(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const showWizard = !state.loading && (needsOnboarding(state) || state.wizardOpen)

  // Boot: primer refresh al montar (actions es estable vía useMemo).
  useEffect(() => {
    void actions.refresh()
  }, [actions])

  // Atajos globales: ⌘K paleta, ⌘G gather, ⌘S scatter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        if (state.palette.open) actions.closePalette()
        else actions.openPalette()
        return
      }
      const canRunSync =
        canSync(state) &&
        conflicts(state).length === 0 &&
        state.modals.length === 0 &&
        !showWizard &&
        !state.busy
      if (key === 'g' && canRunSync) {
        e.preventDefault()
        void actions.openPlan('gather')
      } else if (key === 's' && canRunSync) {
        e.preventDefault()
        void actions.openPlan('scatter')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, actions, showWizard])

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        {state.route === 'home' && <SyncHome />}
        {state.route === 'projects' && <Projects />}
        {state.route === 'machines' && <Machines />}
        {state.route === 'settings' && <Settings />}
      </main>
      {showWizard && <OnboardingWizard />}
      <ModalHost />
      <CommandPalette />
      <ToastHost />
    </div>
  )
}
