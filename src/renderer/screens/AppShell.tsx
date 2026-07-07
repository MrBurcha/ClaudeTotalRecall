import { useEffect } from 'react'
import { ToastHost } from '../components/ToastHost'
import { CommandPalette } from '../features/command-palette/CommandPalette'
import { OnboardingWizard } from '../features/wizard/OnboardingWizard'
import { canSync, conflicts, needsOnboarding } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ModalHost } from './ModalHost'
import { Projects } from './Projects'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import { SyncHome } from './SyncHome'
import { TitleBar } from './TitleBar'

export function AppShell(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const showWizard = !state.loading && (needsOnboarding(state) || state.wizardOpen)

  // Boot: first refresh on mount (actions is stable via useMemo).
  useEffect(() => {
    void actions.refresh()
  }, [actions])

  // Global shortcuts: ⌘K palette, ⌘G gather, ⌘S scatter.
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
      <TitleBar />
      <Sidebar />
      <main className="content">
        {state.route === 'home' && <SyncHome />}
        {state.route === 'projects' && <Projects />}
        {state.route === 'settings' && <Settings />}
      </main>
      {showWizard && <OnboardingWizard />}
      <ModalHost />
      <CommandPalette />
      <ToastHost />
    </div>
  )
}
