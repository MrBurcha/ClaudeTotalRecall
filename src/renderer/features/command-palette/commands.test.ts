import { describe, expect, it } from 'vitest'
import { buildCommands } from './commands'
import { initialState } from '../../state/reducer'
import type { AppState } from '../../state/types'
import type { Actions } from '../../state/useActions'
import type { Config } from '../../../core/types'

// No ejecutamos run(), solo inspeccionamos ids/disabled/labels → stub vacío.
const actions = {} as unknown as Actions

function stateWith(patch: Partial<AppState>): AppState {
  return { ...initialState, ...patch }
}
const cfg: Config = { version: 1, repo: { remote: 'git@x' }, machines: {}, projects: {} }
const ready = stateWith({ config: cfg, machineId: 'm1', preflight: { ok: true, checks: [] } })

function byId(state: AppState, id: string) {
  return buildCommands(state, actions).find((c) => c.id === id)
}

describe('buildCommands', () => {
  it('gather/scatter deshabilitados si no se puede sincronizar', () => {
    expect(byId(initialState, 'gather')?.disabled).toBe(true)
    expect(byId(ready, 'gather')?.disabled).toBe(false)
  })

  it('gather se bloquea si hay conflictos, aun con canSync', () => {
    const withConflict = stateWith({
      ...ready,
      status: { branch: 'main', ahead: 0, behind: 0, dirty: false, conflicted: ['a.md'] },
    })
    expect(byId(withConflict, 'gather')?.disabled).toBe(true)
  })

  it('nuevo proyecto exige máquina registrada', () => {
    expect(byId(stateWith({ config: cfg }), 'new-project')?.disabled).toBe(true)
    expect(byId(ready, 'new-project')?.disabled).toBe(false)
  })

  it('el comando de tema refleja el tema actual', () => {
    expect(byId(stateWith({ theme: 'dark' }), 'theme')?.title).toContain('claro')
    expect(byId(stateWith({ theme: 'light' }), 'theme')?.title).toContain('oscuro')
  })
})
