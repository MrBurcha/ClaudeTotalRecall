import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './reducer'
import { emptyConfig } from '../../core/types'
import type { ModalDescriptor, Snapshot, ToastItem } from './types'

const projectCreate: ModalDescriptor = { kind: 'project-create' }
const about: ModalDescriptor = { kind: 'about' }

describe('reducer', () => {
  it('hydrate dumps the snapshot and turns off loading', () => {
    const snap: Snapshot = {
      config: null,
      machineId: 'm1',
      preflight: { ok: true, checks: [] },
      version: '1.2.3',
      status: null,
    }
    const s = reducer(initialState, { t: 'hydrate', snap })
    expect(s.loading).toBe(false)
    expect(s.machineId).toBe('m1')
    expect(s.version).toBe('1.2.3')
  })

  it('busy toggles the flag', () => {
    expect(reducer(initialState, { t: 'busy', busy: true }).busy).toBe(true)
  })

  it('modals work as a stack (push/replace/pop)', () => {
    let s = reducer(initialState, { t: 'pushModal', modal: projectCreate })
    expect(s.modals).toHaveLength(1)
    s = reducer(s, { t: 'pushModal', modal: about })
    expect(s.modals.map((m) => m.kind)).toEqual(['project-create', 'about'])
    s = reducer(s, { t: 'replaceModal', modal: projectCreate })
    expect(s.modals.map((m) => m.kind)).toEqual(['project-create', 'project-create'])
    s = reducer(s, { t: 'popModal' })
    expect(s.modals).toHaveLength(1)
  })

  it('toasts are a queue with dismiss by id', () => {
    const a: ToastItem = { id: 1, kind: 'ok', msg: 'a' }
    const b: ToastItem = { id: 2, kind: 'err', msg: 'b' }
    let s = reducer(initialState, { t: 'pushToast', toast: a })
    s = reducer(s, { t: 'pushToast', toast: b })
    expect(s.toasts).toHaveLength(2)
    s = reducer(s, { t: 'dismissToast', id: 1 })
    expect(s.toasts.map((t) => t.id)).toEqual([2])
  })

  it('palette does a partial merge of the patch', () => {
    let s = reducer(initialState, { t: 'palette', patch: { open: true, query: 'gath' } })
    expect(s.palette).toEqual({ open: true, query: 'gath', index: 0 })
    s = reducer(s, { t: 'palette', patch: { index: 2 } })
    expect(s.palette).toEqual({ open: true, query: 'gath', index: 2 })
  })

  it('config replaces the shared config live (machines/projects a remote sync brought)', () => {
    // Regression guard for issues #17/#10: after a sync cycle settles, the store
    // reloads config so newly-synced machines/projects surface without a restart.
    const config = emptyConfig('git@example.com:me/mem.git')
    config.machines['m2'] = { os: 'linux', hostname: 'laptop', home: '/home/me' }
    const s = reducer(initialState, { t: 'config', config })
    expect(s.config).toBe(config)
    expect(Object.keys(s.config?.machines ?? {})).toContain('m2')
    // it touches only the config slice
    expect(s.status).toBe(initialState.status)
    expect(s.syncEngine).toBe(initialState.syncEngine)
  })

  it('navigate, theme, wizard and activeOp update their slice', () => {
    expect(reducer(initialState, { t: 'navigate', route: 'projects' }).route).toBe('projects')
    expect(reducer(initialState, { t: 'theme', theme: 'light' }).theme).toBe('light')
    expect(reducer(initialState, { t: 'wizard', open: true }).wizardOpen).toBe(true)
    const op = { verb: 'gather', phase: 'executing' } as const
    expect(reducer(initialState, { t: 'activeOp', op }).activeOp).toEqual(op)
  })
})
