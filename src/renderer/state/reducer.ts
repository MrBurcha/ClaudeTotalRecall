import type { Config, RepoStatus, SyncEngineState } from '../../core/types'
import type {
  ActiveOp,
  AppState,
  ModalDescriptor,
  PaletteState,
  Route,
  Snapshot,
  Theme,
  ToastItem,
} from './types'

/** Reducer actions. Everything is pure and synchronous; I/O lives in useActions. */
export type Action =
  | { t: 'hydrate'; snap: Snapshot }
  | { t: 'busy'; busy: boolean }
  | { t: 'activeOp'; op: ActiveOp | null }
  | { t: 'navigate'; route: Route }
  | { t: 'theme'; theme: Theme }
  | { t: 'pushModal'; modal: ModalDescriptor }
  | { t: 'popModal' }
  | { t: 'replaceModal'; modal: ModalDescriptor }
  | { t: 'pushToast'; toast: ToastItem }
  | { t: 'dismissToast'; id: number }
  | { t: 'palette'; patch: Partial<PaletteState> }
  | { t: 'wizard'; open: boolean }
  | { t: 'syncState'; state: SyncEngineState }
  | { t: 'status'; status: RepoStatus | null }
  | { t: 'config'; config: Config | null }

export const initialState: AppState = {
  config: null,
  status: null,
  machineId: null,
  preflight: null,
  version: null,
  route: 'home',
  theme: 'dark',
  loading: true,
  busy: false,
  activeOp: null,
  modals: [],
  toasts: [],
  palette: { open: false, query: '', index: 0 },
  wizardOpen: false,
  syncEngine: null,
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.t) {
    case 'hydrate':
      return { ...state, ...action.snap, loading: false }
    case 'busy':
      return { ...state, busy: action.busy }
    case 'activeOp':
      return { ...state, activeOp: action.op }
    case 'navigate':
      return { ...state, route: action.route }
    case 'theme':
      return { ...state, theme: action.theme }
    case 'pushModal':
      return { ...state, modals: [...state.modals, action.modal] }
    case 'popModal':
      return { ...state, modals: state.modals.slice(0, -1) }
    case 'replaceModal':
      return { ...state, modals: [...state.modals.slice(0, -1), action.modal] }
    case 'pushToast':
      return { ...state, toasts: [...state.toasts, action.toast] }
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case 'palette':
      return { ...state, palette: { ...state.palette, ...action.patch } }
    case 'wizard':
      return { ...state, wizardOpen: action.open }
    case 'syncState':
      return { ...state, syncEngine: action.state }
    case 'status':
      return { ...state, status: action.status }
    case 'config':
      return { ...state, config: action.config }
    default:
      return state
  }
}
