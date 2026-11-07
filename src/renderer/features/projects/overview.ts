import { USER_LEVEL_SPEC, userLevelLogicalPath } from '../../../core/userLevel'
import type { Config, Machine } from '../../../core/types'
import { machineOrder } from '../pinned/pinnedGroups'

/**
 * Data shaping for the Projects "All paths" overview (#114): one read-only list of
 * everything the config syncs and from where — user-level items, the General pinned
 * files, then every project's slots — with the configured path on each machine.
 * Configuration only, never file contents.
 */

export type OverviewSectionKind = 'user' | 'pinned' | 'project'

/**
 * - mapped: a path is configured on this machine
 * - differs: configured, but not like the other machines (see {@link homeRelative})
 * - missing: a registered machine with no path for this entry
 */
export type CellStatus = 'mapped' | 'differs' | 'missing'

export interface OverviewCell {
  machineId: string
  path: string | null
  status: CellStatus
}

export interface OverviewEntry {
  /** repo logical path — unique, so it's also the React key and the Pinned focus target */
  key: string
  /** slot / pin name */
  name: string
  kind: 'file' | 'dir'
  /** one cell per machine; empty for user-level entries (see `sharedPath`) */
  cells: OverviewCell[]
  /** user-level only: the same home-relative path on every machine */
  sharedPath?: string
  /** registered machines with no path for this entry */
  missing: number
  /** the mapped machines don't all use the same home-relative path */
  differs: boolean
}

export interface OverviewSection {
  /** 'user', 'pinned' or `project:<name>` */
  id: string
  kind: OverviewSectionKind
  project?: string
  entries: OverviewEntry[]
}

const byName = (a: string, b: string): number => a.localeCompare(b)

/**
 * A path in comparable form: forward slashes, with the machine's home replaced by
 * `~`. Literal paths always differ across machines (different homes, separators),
 * so comparing these is what makes "paths differ" mean something. The home prefix
 * matches case-insensitively on Windows.
 */
export function homeRelative(path: string, machine?: Machine): string {
  const p = path.replace(/\\/g, '/')
  if (!machine) return p
  const home = machine.home.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!home) return p
  const fold = (s: string): string => (machine.os === 'windows' ? s.toLowerCase() : s)
  const head = fold(p.slice(0, home.length))
  const next = p.charAt(home.length)
  if (head === fold(home) && (next === '' || next === '/')) return `~${p.slice(home.length)}`
  return p
}

/**
 * Cells for one entry: every registered machine (this one first) plus any
 * unregistered id that still carries a path here. When the mapped registered
 * machines don't agree on a home-relative path, the ones off the most common value
 * are flagged — or all of them when there's no single most common value. An
 * unregistered id has no known home, so it never takes part in that comparison.
 */
function cellsFor(
  config: Config,
  machineId: string | null,
  byMachine: Record<string, string>,
): Pick<OverviewEntry, 'cells' | 'missing' | 'differs'> {
  const ids = machineOrder(config, machineId, [byMachine])
  const rel = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const id of ids) {
    const path = byMachine[id]
    const machine = config.machines[id]
    if (!path || !machine) continue
    const r = homeRelative(path, machine)
    rel.set(id, r)
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const differs = counts.size > 1
  let mode: string | null = null
  if (differs) {
    const top = Math.max(...counts.values())
    const tops = [...counts.entries()].filter(([, n]) => n === top)
    mode = tops.length === 1 ? tops[0][0] : null
  }
  const cells = ids.map((id): OverviewCell => {
    const path = byMachine[id] ?? null
    if (!path) return { machineId: id, path, status: 'missing' }
    const off = differs && rel.has(id) && rel.get(id) !== mode
    return { machineId: id, path, status: off ? 'differs' : 'mapped' }
  })
  return { cells, missing: cells.filter((c) => c.status === 'missing').length, differs }
}

/** Every section, in display order. Projects and their slots are alphabetical. */
export function buildOverview(config: Config, machineId: string | null): OverviewSection[] {
  const user: OverviewSection = {
    id: 'user',
    kind: 'user',
    entries: USER_LEVEL_SPEC.map(({ slot, kind }) => ({
      key: userLevelLogicalPath(slot),
      name: slot,
      kind,
      cells: [],
      sharedPath: `~/.claude/${slot}`,
      missing: 0,
      differs: false,
    })),
  }
  const pins = config.pinnedFiles ?? {}
  const pinned: OverviewSection = {
    id: 'pinned',
    kind: 'pinned',
    entries: Object.keys(pins)
      .sort(byName)
      .map((name): OverviewEntry => ({
        key: `memories/pinned/${name}`,
        name,
        kind: 'file',
        ...cellsFor(config, machineId, pins[name]),
      })),
  }
  const projects = Object.keys(config.projects)
    .sort(byName)
    .map((project): OverviewSection => {
      const p = config.projects[project]
      return {
        id: `project:${project}`,
        kind: 'project',
        project,
        entries: Object.keys(p.folders)
          .sort(byName)
          .map((slot): OverviewEntry => ({
            key: `memories/projects/${project}/${slot}`,
            name: slot,
            kind: p.slotKinds?.[slot] ?? 'dir',
            ...cellsFor(config, machineId, p.folders[slot]),
          })),
      }
    })
  return [user, pinned, ...projects]
}

function entryText(section: OverviewSection, e: OverviewEntry): string {
  return [
    section.project ?? '',
    e.name,
    e.key,
    e.sharedPath ?? '',
    ...e.cells.flatMap((c) => [c.machineId, c.path ?? '']),
  ]
    .join('\n')
    .toLowerCase()
}

/**
 * Keeps the entries where every whitespace-separated word of `query` appears in
 * its project, name, repo path, machine ids or paths (case-insensitive). Sections
 * left empty are dropped — except a project with no sources whose name matches.
 */
export function filterOverview(sections: OverviewSection[], query: string): OverviewSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return sections
  const hit = (text: string): boolean => words.every((w) => text.includes(w))
  return sections.flatMap((s) => {
    const entries = s.entries.filter((e) => hit(entryText(s, e)))
    if (entries.length > 0) return [{ ...s, entries }]
    const emptyProject = s.kind === 'project' && s.entries.length === 0
    return emptyProject && hit((s.project ?? '').toLowerCase()) ? [s] : []
  })
}

export interface OverviewStats {
  entries: number
  /** entries some registered machine has no path for */
  withGaps: number
  /** entries whose machines don't share a home-relative path */
  withDiffs: number
}

export function overviewStats(sections: OverviewSection[]): OverviewStats {
  const all = sections.flatMap((s) => s.entries)
  return {
    entries: all.length,
    withGaps: all.filter((e) => e.missing > 0).length,
    withDiffs: all.filter((e) => e.differs).length,
  }
}
