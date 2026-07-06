import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
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
