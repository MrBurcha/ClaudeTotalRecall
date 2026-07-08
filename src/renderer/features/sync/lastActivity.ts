/**
 * Collapsed-state summary for "Recent activity" (#39): the last time real memory
 * actually changed on this machine — distinct from the sync-bar's "last checked",
 * which bumps on every poll even when nothing moved. Lets the user decide whether
 * to expand the timeline at all.
 *
 * Pure string/data logic on purpose — NO React, NO `t`, NO `node:*` — so it runs
 * under the vitest `node` suite (`src/**\/*.test.ts`) and imports cleanly from the
 * renderer bundle. The i18n-facing rendering lives in RecentActivity.tsx.
 */
import type { HistoryEntry } from '../../../core/types'
import { isStructuralNoise, parseMemoryPath } from '../../../core/memoryPath'

/** Where the last change landed, in the user's bucket vocabulary. */
export type ActivityLocation =
  { kind: 'project'; name: string } | { kind: 'user' } | { kind: 'pinned' } | { kind: 'mixed' }

export interface LastActivitySummary {
  /** ISO timestamp of the entry (author date). */
  at: string
  /** user-visible files changed (structural `.gitkeep` already dropped). */
  fileCount: number
  location: ActivityLocation
}

/**
 * The newest sync entry (`outgoing`/`incoming`) that actually moved real files.
 * Admin commits (register, new-project…) and no-op/`.gitkeep`-only entries are
 * skipped. Returns `null` when there's no real activity to summarize.
 *
 * `entries` are expected newest-first, as `repoHistory()` returns them.
 */
export function summarizeLastActivity(entries: HistoryEntry[]): LastActivitySummary | null {
  for (const e of entries) {
    if (e.type !== 'outgoing' && e.type !== 'incoming') continue
    const visible = e.changes.filter((c) => !isStructuralNoise(c.path))
    if (visible.length === 0) continue
    return { at: e.at, fileCount: visible.length, location: locate(visible) }
  }
  return null
}

/**
 * Collapses a change set into a single location: one project name when every
 * change lives in the same project, a single non-project bucket (user/pinned)
 * when they share one, otherwise `mixed`.
 */
function locate(changes: { path: string }[]): ActivityLocation {
  const buckets = new Set<string>()
  const projects = new Set<string>()
  for (const c of changes) {
    const loc = parseMemoryPath(c.path)
    buckets.add(loc.bucket)
    if (loc.bucket === 'project') projects.add(loc.project)
  }
  if (buckets.size !== 1) return { kind: 'mixed' }
  const only = [...buckets][0]
  if (only === 'project') {
    return projects.size === 1 ? { kind: 'project', name: [...projects][0] } : { kind: 'mixed' }
  }
  if (only === 'user') return { kind: 'user' }
  if (only === 'pinned') return { kind: 'pinned' }
  return { kind: 'mixed' }
}
