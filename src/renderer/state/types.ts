import type {
  Config,
  Plan,
  PlanAction,
  PreflightResult,
  RepoStatus,
  SyncEngineState,
  Verb,
} from '../../core/types'
import type { UpdateState } from '../../core/releaseCheck'

/** Navigable sections of the steady-state (the wizard is a separate takeover). */
export type Route = 'home' | 'projects' | 'pinned' | 'notebook' | 'settings'

/**
 * Something a screen should select when it opens, set by a navigation that wants
 * to land on a specific item (e.g. the Projects overview jumping to one pinned
 * file). Cleared by any plain navigation, so it only applies to the next mount.
 */
export interface RouteFocus {
  route: Route
  /** screen-specific key (for 'pinned': the file's repo logical path) */
  target: string
}
export type Theme = 'dark' | 'light'
export type ToastKind = 'ok' | 'err' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  msg: string
}

/**
 * Modal descriptor. Discriminated union: each overlay carries its own data.
 * The confirm's `resolve` lives only in memory (not serialized) → enables an
 * imperative `confirm(): Promise<boolean>` that replaces window.confirm.
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
  | { kind: 'project-new' }
  | { kind: 'project-scan' }
  | { kind: 'project-discover' }
  | { kind: 'project-adopt'; name: string }
  | { kind: 'about' }
  | { kind: 'file-preview'; path: string; name: string }
  | { kind: 'memory-maintenance' }

/** In-progress sync operation; feeds the constellation's animated state. */
export interface ActiveOp {
  verb: Verb
  phase: 'building' | 'reviewing' | 'executing'
}

export interface PaletteState {
  open: boolean
  query: string
  index: number
}

/** Backend snapshot (what a refresh brings). */
export interface Snapshot {
  config: Config | null
  status: RepoStatus | null
  machineId: string | null
  preflight: PreflightResult | null
  version: string | null
}

export interface AppState {
  // backend snapshot
  config: Config | null
  status: RepoStatus | null
  machineId: string | null
  preflight: PreflightResult | null
  version: string | null
  // UI
  route: Route
  focus: RouteFocus | null
  theme: Theme
  loading: boolean // before the first refresh → skeletons
  busy: boolean // global operation in progress → disables actions
  activeOp: ActiveOp | null
  // overlays
  modals: ModalDescriptor[] // stack
  toasts: ToastItem[] // queue
  palette: PaletteState
  wizardOpen: boolean // wizard takeover forced on-demand
  // auto-sync engine (pushed by main; null until the first getState)
  syncEngine: SyncEngineState | null
  // update check (#66, #134) + wrong-build notice (#133): pushed by main on open + every 24h
  updates: UpdateState
}
