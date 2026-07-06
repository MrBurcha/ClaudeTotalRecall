import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import type { SyncEngineState } from '../../core/types'
import { api } from './api'
import { initialState, reducer, type Action } from './reducer'
import type { AppState, Theme } from './types'

const StateContext = createContext<AppState>(initialState)
const DispatchContext = createContext<Dispatch<Action>>(() => undefined)

/** Lee el tema persistido; el default es dark (dark-first). CSP no gobierna localStorage. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem('claudetr:theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function AppStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({
    ...s,
    theme: readStoredTheme(),
  }))

  // Estado del motor de auto-sync: se pide el actual y se escucha el push en vivo.
  useEffect(() => {
    let alive = true
    // Al asentar un ciclo (no 'syncing'), refrescamos también el RepoStatus: el
    // motor empuja su estado pero no la telemetría (ahead/behind/dirty), así que
    // sin esto el panel Avanzado queda con números viejos aunque diga "Al día".
    const apply = (s: SyncEngineState): void => {
      dispatch({ t: 'syncState', state: s })
      if (s.status !== 'syncing') {
        void api
          .repoStatus()
          .then((status) => {
            if (alive) dispatch({ t: 'status', status })
          })
          .catch(() => {
            /* sin repo todavía; se ignora */
          })
      }
    }
    void api
      .syncGetState()
      .then((s) => {
        if (alive) apply(s)
      })
      .catch(() => {
        /* aún no listo; el push llegará cuando el motor arranque */
      })
    const off = api.onSyncState((s) => apply(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useAppState(): AppState {
  return useContext(StateContext)
}

export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchContext)
}
