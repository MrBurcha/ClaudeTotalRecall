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

/** Reads the persisted theme; the default is dark (dark-first). CSP doesn't govern localStorage. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem('claude-total-recall:theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function AppStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({
    ...s,
    theme: readStoredTheme(),
  }))

  // Auto-sync engine state: request the current one and listen for the live push.
  useEffect(() => {
    let alive = true
    // When a cycle settles (not 'syncing'), we also refresh the RepoStatus: the
    // engine pushes its state but not the telemetry (ahead/behind/dirty), so
    // without this the Avanzado panel keeps stale numbers even if it says "Al día".
    const apply = (s: SyncEngineState): void => {
      dispatch({ t: 'syncState', state: s })
      if (s.status !== 'syncing') {
        void api
          .repoStatus()
          .then((status) => {
            if (alive) dispatch({ t: 'status', status })
          })
          .catch(() => {
            /* no repo yet; ignored */
          })
      }
    }
    void api
      .syncGetState()
      .then((s) => {
        if (alive) apply(s)
      })
      .catch(() => {
        /* not ready yet; the push will arrive when the engine starts */
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
