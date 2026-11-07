import type { TFunction } from 'i18next'
import type { Config } from '../../../core/types'

/**
 * Data shaping for the Pinned files module (#113): every single-file source in
 * the config, grouped like the Notebook tree. "General" holds the global
 * `Config.pinnedFiles`; then one group per project holds that project's
 * file-kind slots (`slotKinds[slot] === 'file'`). Folder slots stay in Projects.
 * No schema change: this is a view over what the config already stores.
 */

export type PinnedScope = 'general' | 'project'

/** Where a new pinned file goes: the global General bucket or a project. */
export type PinnedTarget = { scope: 'general' } | { scope: 'project'; project: string }

/** One single-file source shown in the module. */
export interface PinnedEntry {
  /**
   * Repo logical path (`memories/pinned/<pin>` or `memories/projects/<p>/<slot>`).
   * Unique across the tree, so it doubles as the selection key — and it's exactly
   * what `file:preview` / `file:reveal` take.
   */
  key: string
  scope: PinnedScope
  /** owning project (scope 'project' only) */
  project?: string
  /** pin id (General) or slot name (project) */
  name: string
  /** machineId → literal absolute path on that machine */
  byMachine: Record<string, string>
}

export interface PinnedGroup {
  /** 'general' or `project:<name>` */
  id: string
  scope: PinnedScope
  project?: string
  entries: PinnedEntry[]
}

const byName = (a: string, b: string): number => a.localeCompare(b)

/** Repo logical path of a pinned file (General) or a project file slot. */
export function pinnedLogicalPath(target: PinnedTarget, name: string): string {
  return target.scope === 'general'
    ? `memories/pinned/${name}`
    : `memories/projects/${target.project}/${name}`
}

/** The target (General or its project) an existing entry belongs to. */
export function entryTarget(entry: PinnedEntry): PinnedTarget {
  return entry.scope === 'general'
    ? { scope: 'general' }
    : { scope: 'project', project: entry.project ?? '' }
}

/** Group id of a target, matching {@link PinnedGroup.id}. */
export function groupId(target: PinnedTarget): string {
  return target.scope === 'general' ? 'general' : `project:${target.project}`
}

/**
 * General first, then every project (alphabetical, like the Notebook roots) —
 * including projects with no file source yet, so each one is a place to add to.
 */
export function buildPinnedTree(config: Config): PinnedGroup[] {
  const general: PinnedGroup = {
    id: 'general',
    scope: 'general',
    entries: Object.keys(config.pinnedFiles ?? {})
      .sort(byName)
      .map((name) => ({
        key: pinnedLogicalPath({ scope: 'general' }, name),
        scope: 'general',
        name,
        byMachine: config.pinnedFiles?.[name] ?? {},
      })),
  }
  const projects = Object.keys(config.projects)
    .sort(byName)
    .map((project): PinnedGroup => {
      const p = config.projects[project]
      const entries = Object.keys(p.folders)
        .filter((slot) => (p.slotKinds?.[slot] ?? 'dir') === 'file')
        .sort(byName)
        .map((slot): PinnedEntry => ({
          key: pinnedLogicalPath({ scope: 'project', project }, slot),
          scope: 'project',
          project,
          name: slot,
          byMachine: p.folders[slot],
        }))
      return { id: `project:${project}`, scope: 'project', project, entries }
    })
  return [general, ...projects]
}

export function findPinnedEntry(groups: PinnedGroup[], key: string | null): PinnedEntry | null {
  if (!key) return null
  for (const g of groups) {
    const hit = g.entries.find((e) => e.key === key)
    if (hit) return hit
  }
  return null
}

/**
 * Display order of machines: this machine first, then the other registered
 * machines (config order), then any id that still carries a path in one of the
 * maps but isn't registered — so no configured path is ever hidden.
 */
export function machineOrder(
  config: Config,
  machineId: string | null,
  maps: ReadonlyArray<Record<string, string>> = [],
): string[] {
  const ids = new Set<string>()
  if (machineId) ids.add(machineId)
  for (const id of Object.keys(config.machines)) ids.add(id)
  for (const m of maps) for (const id of Object.keys(m)) ids.add(id)
  return [...ids]
}

export interface MachinePathRow {
  machineId: string
  /** literal path on that machine, or null when it isn't mapped there */
  path: string | null
  current: boolean
}

/** One row per machine for the detail pane, unmapped machines included. */
export function machinePathRows(
  config: Config,
  byMachine: Record<string, string>,
  machineId: string | null,
): MachinePathRow[] {
  return machineOrder(config, machineId, [byMachine]).map((id) => ({
    machineId: id,
    path: byMachine[id] ?? null,
    current: id === machineId,
  }))
}

/**
 * Names a new file in `target` can't reuse. For a project that's EVERY slot, not
 * just files: saving a file under a folder slot's name would flip that slot to a
 * file. Compared case-insensitively by {@link validateFileName}, since the repo
 * path would collide on macOS/Windows.
 */
export function takenNames(config: Config, target: PinnedTarget): string[] {
  if (target.scope === 'general') return Object.keys(config.pinnedFiles ?? {})
  return Object.keys(config.projects[target.project]?.folders ?? {})
}

// Mirrors service.ts assertSafeName (the name is a repo path segment); the core
// revalidates anyway — this is just instant feedback.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/

export function validateFileName(value: string, taken: string[], t: TFunction): string | null {
  const v = value.trim()
  if (!v) return t('pinned.nameRequired')
  if (!SAFE_NAME.test(v) || /^\.+$/.test(v)) return t('pinned.nameInvalid')
  const lower = v.toLowerCase()
  if (taken.some((n) => n.toLowerCase() === lower)) return t('pinned.nameTaken')
  return null
}

/** Last segment of a path in either separator style. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/** A default name from a picked file: its basename with unsafe characters replaced. */
export function suggestName(path: string): string {
  const v = baseName(path)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return /^\.*$/.test(v) ? '' : v
}

/**
 * The file name used to pick a preview renderer. A slot's name needn't carry the
 * real extension (slot "rules" → `AGENTS.md`), so prefer a mapped path's basename —
 * this machine's first — and fall back to the entry name.
 */
export function previewFileName(entry: PinnedEntry, machineId: string | null): string {
  const path =
    (machineId ? entry.byMachine[machineId] : undefined) ?? Object.values(entry.byMachine)[0]
  return (path && baseName(path)) || entry.name
}
