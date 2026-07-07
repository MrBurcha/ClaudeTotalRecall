import type { Plan, PlanAction, PlanActionType } from '../../../core/types'

/**
 * Groups a Plan's actions by origin (user level vs each project) by splitting the
 * `slot` prefix (which resolve.ts/plan.ts emit as "user:…" or
 * "project:<name>/<slot>/…"). Pure and testable. Kept locale-agnostic: `title`
 * holds the project name for projects and the marker "user" for the user group;
 * the renderer localizes the user group via `kind` (see PlanReview).
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
  /** At least one action mutates disk (create/overwrite/delete). */
  mutating: boolean
}

function groupFor(slot: string): { key: string; title: string; kind: 'user' | 'project' } {
  if (slot.startsWith('project:')) {
    const name = slot.slice('project:'.length).split('/')[0] || '(project)'
    return { key: `project:${name}`, title: name, kind: 'project' }
  }
  return { key: 'user', title: 'user', kind: 'user' }
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

  // User first, then projects in alphabetical order.
  const groups = [...map.values()].sort((x, y) => {
    if (x.kind !== y.kind) return x.kind === 'user' ? -1 : 1
    return x.title.localeCompare(y.title)
  })

  const mutating = counts.create + counts.overwrite + counts.delete > 0
  return { groups, counts, mutating }
}
