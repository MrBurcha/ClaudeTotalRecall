import { join, resolve as resolvePath, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { USER_LEVEL_EXCLUDES } from './managedPaths'
import { parseMemoryPath } from './memoryPath'
import type { Config } from './types'
import { USER_LEVEL_SPEC, userLevelLogicalPath } from './userLevel'

export interface UserLevelItem {
  slot: string
  realPath: string
  logicalPath: string
  kind: 'file' | 'dir'
  /**
   * Top-level entries of a dir slot that Claude Code manages itself and that never
   * sync in either direction (e.g. `skills/synced`, #135). Empty for most slots.
   */
  exclude: readonly string[]
}

/**
 * Fixed user-level slots (USER_LEVEL_SPEC, in the node-free userLevel.ts). `logicalPath`
 * is relative to the repo root; `realPath` is expanded against ~/.claude via the adapter.
 */
export function userLevelItems(adapter: PlatformAdapter): UserLevelItem[] {
  const claudeHome = adapter.claudeHome()
  return USER_LEVEL_SPEC.map(({ slot, kind }) => ({
    slot,
    realPath: join(claudeHome, slot),
    logicalPath: userLevelLogicalPath(slot),
    kind,
    exclude: USER_LEVEL_EXCLUDES[slot] ?? [],
  }))
}

/**
 * Literal absolute path of a project slot for a machine, or null if the
 * project, the slot or the machineId is not mapped.
 */
export function projectSlotPath(
  config: Config,
  projectName: string,
  slot: string,
  machineId: string,
): string | null {
  const project = config.projects[projectName]
  if (!project) return null
  const folder = project.folders[slot]
  if (!folder) return null
  const path = folder[machineId]
  return path ?? null
}

/** Slot names of the project, [] if it doesn't exist. */
export function projectSlots(config: Config, projectName: string): string[] {
  const project = config.projects[projectName]
  if (!project) return []
  return Object.keys(project.folders)
}

/** Repo logicalPath for a project slot. */
export function projectSlotLogicalPath(projectName: string, slot: string): string {
  return `memories/projects/${projectName}/${slot}`
}

/** Kind of a project slot: single file vs mirrored folder (default 'dir'). */
export function projectSlotKind(config: Config, projectName: string, slot: string): 'file' | 'dir' {
  return config.projects[projectName]?.slotKinds?.[slot] ?? 'dir'
}

/** A global pinned file mapped for a machine. */
export interface PinnedFileItem {
  pinId: string
  /** literal absolute path on this machine (already expanded when saved) */
  realPath: string
  /** logicalPath in the repo (memories/pinned/<pinId>) */
  logicalPath: string
}

/** Global pinned files that have a path on `machineId` (always kind 'file'). */
export function pinnedFileItems(config: Config, machineId: string): PinnedFileItem[] {
  const out: PinnedFileItem[] = []
  for (const [pinId, byMachine] of Object.entries(config.pinnedFiles ?? {})) {
    const p = byMachine[machineId]
    if (p) out.push({ pinId, realPath: p, logicalPath: `memories/pinned/${pinId}` })
  }
  return out
}

/**
 * True if two absolute paths are the same or one is nested inside the other.
 * Normalizes both (collapses `.`/`..`/trailing slash with `resolve`) and compares at
 * the separator BOUNDARY, so `/tmp/ab` does NOT collide with `/tmp/abc`. Case-sensitive.
 */
export function pathsCollide(a: string, b: string): boolean {
  const na = resolvePath(a)
  const nb = resolvePath(b)
  if (na === nb) return true
  const aPrefix = na.endsWith(sep) ? na : na + sep
  const bPrefix = nb.endsWith(sep) ? nb : nb + sep
  return nb.startsWith(aPrefix) || na.startsWith(bPrefix)
}

/** A path already synced on a machine, with a label for the error message. */
export interface SyncedPath {
  path: string
  where: string
  /** Canonical name of the owning project, if the path comes from a project slot. */
  project?: string
}

/**
 * Every path that `machineId` ALREADY syncs: that machine's project slots
 * (except the `exclude` being edited, so it doesn't collide with itself) plus the
 * user-level dir roots (`~/.claude/{commands,agents,skills}`, which sync
 * recursively). Basis for the anti-nesting check in `setProjectFolder`.
 */
export function machineSyncedPaths(
  config: Config,
  adapter: PlatformAdapter,
  machineId: string,
  exclude?: { project: string; slot: string } | { pin: string },
): SyncedPath[] {
  const out: SyncedPath[] = []
  const excludeSlot = exclude && 'project' in exclude ? exclude : undefined
  const excludePin = exclude && 'pin' in exclude ? exclude.pin : undefined
  for (const [projectName, project] of Object.entries(config.projects)) {
    for (const [slot, folder] of Object.entries(project.folders)) {
      if (excludeSlot && excludeSlot.project === projectName && excludeSlot.slot === slot) continue
      const p = folder[machineId]
      if (p) out.push({ path: p, where: `${projectName}/${slot}`, project: projectName })
    }
  }
  for (const [pinId, byMachine] of Object.entries(config.pinnedFiles ?? {})) {
    if (excludePin === pinId) continue
    const p = byMachine[machineId]
    if (p) out.push({ path: p, where: `pinned/${pinId}` })
  }
  for (const item of userLevelItems(adapter)) {
    if (item.kind === 'dir') out.push({ path: item.realPath, where: `~/.claude/${item.slot}` })
  }
  return out
}

/**
 * Reverse of the logical-path builders: given a repo-relative memories path,
 * return the real file path on THIS machine (the user's configured source), or
 * null when it isn't mapped here (project/slot/pin not configured for this
 * machine, or an unrecognized path). Used to reveal a file in the OS file
 * manager — never to read content (that comes from the working copy).
 */
export function machinePathForLogical(
  repoRelPath: string,
  config: Config,
  machineId: string,
  adapter: PlatformAdapter,
): string | null {
  const loc = parseMemoryPath(repoRelPath)
  switch (loc.bucket) {
    case 'user': {
      const base = join(adapter.claudeHome(), loc.slot)
      return loc.rest ? join(base, loc.rest) : base
    }
    case 'project': {
      const base = projectSlotPath(config, loc.project, loc.slot, machineId)
      if (!base) return null
      if (projectSlotKind(config, loc.project, loc.slot) === 'file') return base
      return loc.rest ? join(base, loc.rest) : base
    }
    case 'pinned':
      return config.pinnedFiles?.[loc.pin]?.[machineId] ?? null
    default:
      return null
  }
}
