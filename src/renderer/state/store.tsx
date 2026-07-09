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
    // When a cycle settles (not 'syncing'), we refresh two things the engine's push
    // does NOT carry, both of which a remote pull may have changed on disk:
    //   1. RepoStatus telemetry (ahead/behind/dirty) — else "Avanzado" shows stale numbers.
    //   2. The shared config (machines/projects/folders/remote) — else a machine or
    //      project synced from another machine stays invisible until restart. The
    //      engine only pushes SyncEngineState, never the config, and config:load reads
    //      fresh from the (just-pulled) working copy. Fixes issues #17 and #10.
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
        void api
          .configLoad()
          .then((config) => {
            // Guard on truthy: a transient read error returns null (config:load swallows
            // it) and we keep the last good config instead of blanking the lists.
            if (alive && config) dispatch({ t: 'config', config })
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

  // Update check (#66): same pull-then-subscribe shape as the sync engine above.
  useEffect(() => {
    let alive = true
    void api
      .updateGetState()
      .then((s) => {
        if (alive) dispatch({ t: 'updateAvailable', state: s })
      })
      .catch(() => {
        /* not ready yet; the push will arrive when the first check completes */
      })
    const off = api.onUpdateState((s) => dispatch({ t: 'updateAvailable', state: s }))
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
