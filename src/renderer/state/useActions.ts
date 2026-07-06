import { useMemo, useRef, type Dispatch } from 'react'
import { api, normalizeError } from './api'
import type { Action } from './reducer'
import { useAppState, useDispatch } from './store'
import type { AppState, ModalDescriptor, Route, Theme } from './types'
import type { Verb } from '../../core/types'

// Contador de ids para toasts/modales (el renderer sí puede usar estado mutable).
let seq = 0
const nextId = (): number => (seq += 1)

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('claudetr:theme', theme)
  } catch {
    /* localStorage puede fallar en modos exóticos; el tema en memoria alcanza. */
  }
}

/**
 * Toda la I/O async y los efectos viven acá (el reducer es puro). Las funciones
 * leen el estado más reciente vía stateRef para no capturar closures viejas.
 * Reemplaza el run()/refresh()/notify() que estaban sueltos en el App.tsx viejo.
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

  /** Envuelve una acción mutante: busy on/off, refresh, y toast de éxito/error. */
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

  /** Confirmación imperativa in-app (reemplaza window.confirm). */
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
          confirmLabel: opts.confirmLabel ?? 'Confirmar',
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
  const toggleTheme = (): void =>
    setTheme(stateRef.current.theme === 'dark' ? 'light' : 'dark')

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

  // ── Sincronización ─────────────────────────────────────────────────────────
  /** Arma el Plan (pull previo si es scatter) y abre el modal de review. */
  const openPlan = async (verb: Verb): Promise<void> => {
    dispatch({ t: 'busy', busy: true })
    dispatch({ t: 'activeOp', op: { verb, phase: 'building' } })
    try {
      if (verb === 'scatter') {
        const pulled = await api.repoPull()
        if (!pulled.ok) {
          await refresh()
          throw new Error(
            `Resolvé los conflictos antes de bajar (scatter): ${pulled.conflicts.join(', ')}`,
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

  /** Ejecuta el Plan confirmado. Ante drift abre el diálogo de reconstruir/forzar. */
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
        notify(`Conflictos al integrar: ${res.conflicts.join(', ')}. Resolvelos abajo.`, 'info')
      } else {
        const label = verb === 'gather' ? 'Gather' : 'Scatter'
        notify(`${label} aplicado: ${res.exec.applied} acción(es).`, 'ok')
      }
    } catch (e) {
      notify(normalizeError(e), 'err')
    } finally {
      dispatch({ t: 'busy', busy: false })
      dispatch({ t: 'activeOp', op: null })
    }
  }

  /** Desde el diálogo de drift: cierra y reconstruye el Plan desde cero. */
  const rebuildPlan = async (verb: Verb): Promise<void> => {
    dispatch({ t: 'popModal' })
    await openPlan(verb)
  }

  // ── Auto-sync (motor en el main) ─────────────────────────────────────────────
  /** Disparo manual: corre un ciclo completo y refresca el telemetry del repo. */
  const syncNow = async (): Promise<void> => {
    try {
      dispatch({ t: 'syncState', state: await api.syncNow() })
      await refresh()
    } catch (e) {
      notify(normalizeError(e), 'err')
    }
  }

  /** Activa/desactiva el auto-sync conservando el intervalo actual. */
  const setAutoSync = async (enabled: boolean): Promise<void> => {
    const intervalMs = stateRef.current.syncEngine?.intervalMs ?? 120_000
    try {
      dispatch({ t: 'syncState', state: await api.syncSetAuto(enabled, intervalMs) })
    } catch (e) {
      notify(normalizeError(e), 'err')
    }
  }

  /** Cambia el intervalo de poll del remoto conservando el on/off. */
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
