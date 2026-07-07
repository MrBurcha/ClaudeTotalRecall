import { describe, expect, it } from 'vitest'
import { groupActions } from './groupActions'
import type { Plan, PlanAction, PlanActionType } from '../../../core/types'

function act(slot: string, type: PlanActionType): PlanAction {
  return { slot, logicalPath: slot.replace(/:/g, '/'), from: null, to: null, type }
}

function plan(actions: PlanAction[]): Plan {
  return { id: 'p1', verb: 'gather', createdAt: '2026-01-01T00:00:00Z', actions }
}

describe('groupActions', () => {
  it('groups by user and by project', () => {
    const g = groupActions(
      plan([
        act('user:CLAUDE.md', 'overwrite'),
        act('user:settings.json', 'noop'),
        act('project:demo/memory/a.md', 'create'),
        act('project:otro/memory/b.md', 'skip'),
      ]),
    )
    expect(g.groups.map((x) => x.title)).toEqual(['user', 'demo', 'otro'])
    expect(g.groups[0].kind).toBe('user')
    expect(g.groups[1].kind).toBe('project')
  })

  it('counts by type and detects mutation', () => {
    const g = groupActions(
      plan([act('user:CLAUDE.md', 'create'), act('user:x', 'noop'), act('project:d/m/y', 'delete')]),
    )
    expect(g.counts.create).toBe(1)
    expect(g.counts.delete).toBe(1)
    expect(g.counts.noop).toBe(1)
    expect(g.mutating).toBe(true)
  })

  it('with no mutating actions → mutating false', () => {
    const g = groupActions(plan([act('user:CLAUDE.md', 'noop'), act('project:d/m/y', 'skip')]))
    expect(g.mutating).toBe(false)
  })

  it('orders the user group before projects', () => {
    const g = groupActions(
      plan([act('project:zeta/m/a', 'create'), act('user:CLAUDE.md', 'create')]),
    )
    expect(g.groups[0].title).toBe('user')
  })
})
