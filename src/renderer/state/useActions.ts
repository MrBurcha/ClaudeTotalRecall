import { useMemo, useRef, type Dispatch } from 'react'
import { api, normalizeError } from './api'
import type { Action } from './reducer'
import { useAppState, useDispatch } from './store'
import type { AppState, ModalDescriptor, Route, Theme } from './types'
import type { Verb } from '../../core/types'
import i18n from '../i18n'

// Id counter for toasts/modals (the renderer may use mutable state).
let seq = 0
const nextId = (): number => (seq += 1)

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('claude-total-recall:theme', theme)
  } catch {
    /* localStorage may fail in exotic modes; the in-memory theme is enough. */
  }
}

/**
 * All async I/O and effects live here (the reducer is pure). The functions read
 * the latest state via stateRef so they never capture stale closures. Replaces the
 * run()/refresh()/notify() that used to be loose in the old App.tsx.
 */
function makeActions(dispatch: Dispatch<Action>, stateRef: { current: AppState }) {
  const notify = (msg: string, kind: 'ok' | 'err' | 'info' = 'ok'): void =>
    dispatch({ t: 'pushToast', toast: { id: nextId(), kind, msg } })

  const dismissToast = (id: number): void => dispatch({ t: 'dismissToast', id })

  const refresh = async (): Promise<void> => {
    const [config, machineId, preflight, version] = await Promise.all([
      api.configLoad(),
      api.machineCurrent(),
      api.preflightRun(),
      api.appVersion(),
    ])
    let status = null
    if (config) {
      try {
        status = await api.repoStatus()
      } catch {
        status = null
      }
    }
    dispatch({ t: 'hydrate', snap: { config, machineId, preflight, version, status } })
  }

  /** Wraps a mutating action: busy on/off, refresh, and success/error toast. */
  const run = async (fn: () => Promise<string | void>): Promise<void> => {
    dispatch({ t: 'busy', busy: true })
    try {
      const msg = await fn()
      await refresh()
      if (msg) notify(msg, 'ok')
    } catch (e) {
      notify(normalizeError(e), 'err')
    } finally {
      dispatch({ t: 'busy', busy: false })
    }
  }

  /** Imperative in-app confirmation (replaces window.confirm). */
  const confirm = (opts: {
    title: string
    body: string
    confirmLabel?: string
    danger?: boolean
  }): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      dispatch({
        t: 'pushModal',
        modal: {
          kind: 'confirm',
          id: nextId(),
          title: opts.title,
          body: opts.body,
          confirmLabel: opts.confirmLabel ?? i18n.t('common.confirm'),
          danger: opts.danger,
          resolve,
        },
      })
    })

  const settleConfirm = (
    modal: Extract<ModalDescriptor, { kind: 'confirm' }>,
    ok: boolean,
  ): void => {
    modal.resolve(ok)
    dispatch({ t: 'popModal' })
  }

  const navigate = (route: Route): void => dispatch({ t: 'navigate', route })

  const setTheme = (theme: Theme): void => {
    dispatch({ t: 'theme', theme })
    applyTheme(theme)
  }
  const toggleTheme = (): void => setTheme(stateRef.current.theme === 'dark' ? 'light' : 'dark')

  const openModal = (modal: ModalDescriptor): void => dispatch({ t: 'pushModal', modal })
  const closeModal = (): void => dispatch({ t: 'popModal' })

  const openPalette = (): void =>
    dispatch({ t: 'palette', patch: { open: true, query: '', index: 0 } })
  const closePalette = (): void => dispatch({ t: 'palette', patch: { open: false } })
  const setPaletteQuery = (query: string): void =>
    dispatch({ t: 'palette', patch: { query, index: 0 } })
  const setPaletteIndex = (index: number): void => dispatch({ t: 'palette', patch: { index } })

  const openWizard = (): void => dispatch({ t: 'wizard', open: true })
  const closeWizard = (): void => dispatch({ t: 'wizard', open: false })

  // ── Synchronization ────────────────────────────────────────────────────────
  /** Builds the Plan (pulling first if incoming) and opens the review modal. */
  const openPlan = async (verb: Verb): Promise<void> => {
    dispatch({ t: 'busy', busy: true })
    dispatch({ t: 'activeOp', op: { verb, phase: 'building' } })
    try {
      if (verb === 'incoming') {
        const pulled = await api.repoPull()
        if (!pulled.ok) {
          await refresh()
          throw new Error(
            i18n.t('sync.resolveBeforeIncoming', { conflicts: pulled.conflicts.join(', ') }),
          )
        }
      }
      const plan = await api.planBuild(verb)
      dispatch({ t: 'activeOp', op: { verb, phase: 'reviewing' } })
      dispatch({ t: 'pushModal', modal: { kind: 'plan-review', verb, plan } })
    } catch (e) {
      dispatch({ t: 'activeOp', op: null })
      notify(normalizeError(e), 'err')
    } finally {
      dispatch({ t: 'busy', busy: false })
    }
  }

  /** Runs the confirmed Plan. On drift it opens the rebuild/force dialog. */
  const executePlan = async (verb: Verb, planId: string, force = false): Promise<void> => {
    dispatch({ t: 'popModal' })
    dispatch({ t: 'busy', busy: true })
    dispatch({ t: 'activeOp', op: { verb, phase: 'executing' } })
    try {
      const outcome = await api.planExecute(verb, planId, force)
      if (!outcome.ok) {
        dispatch({
          t: 'pushModal',
          modal: { kind: 'plan-drift', verb, planId, drifted: outcome.drifted },
        })
        return
      }
      await refresh()
      const res = outcome.result
      if ('conflicts' in res && res.conflicts.length > 0) {
        notify(i18n.t('sync.integrateConflicts', { conflicts: res.conflicts.join(', ') }), 'info')
      } else {
        const label = i18n.t(verb === 'outgoing' ? 'sync.outgoing' : 'sync.incoming')
        notify(i18n.t('sync.applied', { count: res.exec.applied, verb: label }), 'ok')
      }
    } catch (e) {
      notify(normalizeError(e), 'err')
    } finally {
      dispatch({ t: 'busy', busy: false })
      dispatch({ t: 'activeOp', op: null })
    }
  }

  /** From the drift dialog: close and rebuild the Plan from scratch. */
  const rebuildPlan = async (verb: Verb): Promise<void> => {
    dispatch({ t: 'popModal' })
    await openPlan(verb)
  }

  // ── Auto-sync (engine in main) ───────────────────────────────────────────────
  /** Manual trigger: runs a full cycle and refreshes the repo telemetry. */
  const syncNow = async (): Promise<void> => {
    try {
      dispatch({ t: 'syncState', state: await api.syncNow() })
      await refresh()
    } catch (e) {
      notify(normalizeError(e), 'err')
    }
  }

  /** Toggles auto-sync on/off, keeping the current interval. */
  const setAutoSync = async (enabled: boolean): Promise<void> => {
    const intervalMs = stateRef.current.syncEngine?.intervalMs ?? 120_000
    try {
      dispatch({ t: 'syncState', state: await api.syncSetAuto(enabled, intervalMs) })
    } catch (e) {
      notify(normalizeError(e), 'err')
    }
  }

  /** Changes the remote poll interval, keeping the on/off state. */
  const setSyncInterval = async (intervalMs: number): Promise<void> => {
    const enabled = stateRef.current.syncEngine?.auto ?? true
    try {
      dispatch({ t: 'syncState', state: await api.syncSetAuto(enabled, intervalMs) })
    } catch (e) {
      notify(normalizeError(e), 'err')
    }
  }

  return {
    notify,
    dismissToast,
    refresh,
    run,
    confirm,
    settleConfirm,
    navigate,
    setTheme,
    toggleTheme,
    openModal,
    closeModal,
    openPalette,
    closePalette,
    setPaletteQuery,
    setPaletteIndex,
    openWizard,
    closeWizard,
    openPlan,
    executePlan,
    rebuildPlan,
    syncNow,
    setAutoSync,
    setSyncInterval,
  }
}

export type Actions = ReturnType<typeof makeActions>

export function useActions(): Actions {
  const dispatch = useDispatch()
  const state = useAppState()
  const stateRef = useRef(state)
  stateRef.current = state
  return useMemo(() => makeActions(dispatch, stateRef), [dispatch])
}
