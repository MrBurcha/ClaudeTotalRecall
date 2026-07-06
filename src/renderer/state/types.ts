import type { Config, Plan, PlanAction, PreflightResult, RepoStatus, Verb } from '../../core/types'

/** Secciones navegables del steady-state (el wizard es un takeover aparte). */
export type Route = 'home' | 'projects' | 'machines' | 'settings'
export type Theme = 'dark' | 'light'
export type ToastKind = 'ok' | 'err' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  msg: string
}

/**
 * Descriptor de modal. Unión discriminada: cada overlay lleva sus datos.
 * El `resolve` del confirm vive solo en memoria (no se serializa) → habilita
 * un `confirm(): Promise<boolean>` imperativo que reemplaza window.confirm.
 */
export type ModalDescriptor =
  | {
      kind: 'confirm'
      id: number
      title: string
      body: string
      confirmLabel: string
      danger?: boolean
      resolve: (ok: boolean) => void
    }
  | { kind: 'plan-review'; verb: Verb; plan: Plan }
  | { kind: 'plan-drift'; verb: Verb; planId: string; drifted: PlanAction[] }
  | { kind: 'project-create' }
  | { kind: 'folder-form'; project: string; slot?: string; path?: string }
  | { kind: 'about' }

/** Operación de sync en curso; alimenta el estado animado de la constelación. */
export interface ActiveOp {
  verb: Verb
  phase: 'building' | 'reviewing' | 'executing'
}

export interface PaletteState {
  open: boolean
  query: string
  index: number
}

/** Snapshot del backend (lo que trae un refresh). */
export interface Snapshot {
  config: Config | null
  status: RepoStatus | null
  machineId: string | null
  preflight: PreflightResult | null
  version: string | null
}

export interface AppState {
  // snapshot backend
  config: Config | null
  status: RepoStatus | null
  machineId: string | null
  preflight: PreflightResult | null
  version: string | null
  // UI
  route: Route
  theme: Theme
  loading: boolean // antes del primer refresh → skeletons
  busy: boolean // operación global en curso → deshabilita acciones
  activeOp: ActiveOp | null
  // overlays
  modals: ModalDescriptor[] // stack
  toasts: ToastItem[] // cola
  palette: PaletteState
  wizardOpen: boolean // takeover del wizard forzado on-demand
}
