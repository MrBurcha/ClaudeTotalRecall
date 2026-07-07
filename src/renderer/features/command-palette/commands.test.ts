import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { buildCommands } from './commands'
import { initialState } from '../../state/reducer'
import type { AppState } from '../../state/types'
import type { Actions } from '../../state/useActions'
import type { Config } from '../../../core/types'

// We never call run(), only inspect ids/disabled/labels → empty stub.
const actions = {} as unknown as Actions
// Identity t: returns the key verbatim so we can assert on stable keys, not text.
const t = ((key: string) => key) as unknown as TFunction

function stateWith(patch: Partial<AppState>): AppState {
  return { ...initialState, ...patch }
}
const cfg: Config = { version: 1, repo: { remote: 'git@x' }, machines: {}, projects: {} }
const ready = stateWith({ config: cfg, machineId: 'm1', preflight: { ok: true, checks: [] } })

function byId(state: AppState, id: string) {
  return buildCommands(state, actions, t).find((c) => c.id === id)
}

describe('buildCommands', () => {
  it('outgoing/incoming disabled when sync is not possible', () => {
    expect(byId(initialState, 'outgoing')?.disabled).toBe(true)
    expect(byId(ready, 'outgoing')?.disabled).toBe(false)
  })

  it('outgoing is blocked when there are conflicts, even with canSync', () => {
    const withConflict = stateWith({
      ...ready,
      status: { branch: 'main', ahead: 0, behind: 0, dirty: false, conflicted: ['a.md'] },
    })
    expect(byId(withConflict, 'outgoing')?.disabled).toBe(true)
  })

  it('new project requires a registered machine', () => {
    expect(byId(stateWith({ config: cfg }), 'new-project')?.disabled).toBe(true)
    expect(byId(ready, 'new-project')?.disabled).toBe(false)
  })

  it('the theme command reflects the current theme', () => {
    expect(byId(stateWith({ theme: 'dark' }), 'theme')?.title).toBe('palette.theme.toLight')
    expect(byId(stateWith({ theme: 'light' }), 'theme')?.title).toBe('palette.theme.toDark')
  })
})
