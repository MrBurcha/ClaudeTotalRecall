import type { Plan, PlanAction, PlanActionType } from '../../../core/types'

/**
 * Agrupa las acciones de un Plan por origen (nivel usuario vs cada proyecto),
 * partiendo el prefijo del `slot` (que resolve.ts/plan.ts generan como
 * "user:…" o "project:<name>/<slot>/…"). Puro y testeable.
 */

export interface PlanGroup {
  key: string
  title: string
  kind: 'user' | 'project'
  actions: PlanAction[]
}

export type PlanCounts = Record<PlanActionType, number>

export interface GroupedPlan {
  groups: PlanGroup[]
  counts: PlanCounts
  /** Hay al menos una acción que muta disco (create/overwrite/delete). */
  mutating: boolean
}

function groupFor(slot: string): { key: string; title: string; kind: 'user' | 'project' } {
  if (slot.startsWith('project:')) {
    const name = slot.slice('project:'.length).split('/')[0] || '(proyecto)'
    return { key: `project:${name}`, title: name, kind: 'project' }
  }
  return { key: 'user', title: 'Usuario', kind: 'user' }
}

export function groupActions(plan: Plan): GroupedPlan {
  const counts: PlanCounts = { create: 0, overwrite: 0, delete: 0, noop: 0, skip: 0 }
  const map = new Map<string, PlanGroup>()

  for (const a of plan.actions) {
    counts[a.type] += 1
    const g = groupFor(a.slot)
    let group = map.get(g.key)
    if (!group) {
      group = { key: g.key, title: g.title, kind: g.kind, actions: [] }
      map.set(g.key, group)
    }
    group.actions.push(a)
  }

  // Usuario primero, luego proyectos por orden alfabético.
  const groups = [...map.values()].sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'user' ? -1 : 1
    return x.title.localeCompare(y.title)
  })

  const mutating = counts.create + counts.overwrite + counts.delete > 0
  return { groups, counts, mutating }
}
