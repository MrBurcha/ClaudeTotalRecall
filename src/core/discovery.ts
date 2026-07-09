import { statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { isSecretExcluded } from './plan'
import {
  machineSyncedPaths,
  pathsCollide,
  projectSlotKind,
  projectSlotPath,
  projectSlots,
} from './resolve'
import type { Config } from './types'

export type SlotKind = 'file' | 'dir'

/** Derives a filesystem/config-safe slug from an arbitrary string (lowercase + hyphenate). */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function statOrNull(p: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(p)
  } catch {
    return null
  }
}

// ── Flow A: discover project sources in a selected directory ────────────────

/** The recognized Claude-memory names. `memory` is a per-project folder; the rest mirror the user-level vocabulary. */
export type DiscoveryItem =
  'memory' | 'commands' | 'agents' | 'skills' | 'CLAUDE.md' | 'settings.json'

/**
 * The vocabulary the recognizer looks for, in proposal order: `memory` first,
 * then the remaining dirs alphabetically, then the files. The recognizer stats
 * these fixed names directly — it never enumerates the directory — so a huge dir
 * or one full of transcripts is a non-issue by construction.
 */
const VOCABULARY: ReadonlyArray<{ item: DiscoveryItem; kind: SlotKind }> = [
  { item: 'memory', kind: 'dir' },
  { item: 'agents', kind: 'dir' },
  { item: 'commands', kind: 'dir' },
  { item: 'skills', kind: 'dir' },
  { item: 'CLAUDE.md', kind: 'file' },
  { item: 'settings.json', kind: 'file' },
]

export interface DiscoveredSlot {
  slot: string
  path: string
  kind: SlotKind
  item: DiscoveryItem
  /** Default true; false when the path overlaps something already synced on this machine. */
  include: boolean
  collision?: { with: string; where: string; project?: string }
}

export interface DiscoveryProposal {
  projectName: string
  root: string
  /** True when the selected directory itself is a `memory` folder → a single `memory` slot. */
  rootIsMemory: boolean
  slots: DiscoveredSlot[]
}

/**
 * Scans `selectedDir` for the Claude-memory vocabulary and returns a proposal the
 * UI can review and confirm. Pure/read-only: it stats candidates and marks (but
 * never rejects) collisions against paths already synced on this machine. A
 * missing/non-directory selection yields an empty proposal (no throw), mirroring
 * the tolerant enumeration in `plan.ts`.
 */
export async function discoverProjectSources(
  selectedDir: string,
  config: Config,
  adapter: PlatformAdapter,
  machineId: string,
): Promise<DiscoveryProposal> {
  const root = selectedDir
  const synced = machineSyncedPaths(config, adapter, machineId)
  const collisionFor = (path: string): DiscoveredSlot['collision'] => {
    for (const sp of synced) {
      if (pathsCollide(path, sp.path))
        return { with: sp.path, where: sp.where, project: sp.project }
    }
    return undefined
  }
  const makeSlot = (item: DiscoveryItem, path: string, kind: SlotKind): DiscoveredSlot => {
    const collision = collisionFor(path)
    const s: DiscoveredSlot = { slot: item, path, kind, item, include: !collision }
    if (collision) s.collision = collision
    return s
  }

  const rootStat = await statOrNull(root)
  if (!rootStat || !rootStat.isDirectory()) {
    return { projectName: slug(basename(root)) || 'memory', root, rootIsMemory: false, slots: [] }
  }

  // The selected dir is itself a `memory` folder → one slot, project named after the parent.
  if (basename(root) === 'memory') {
    return {
      projectName: slug(basename(dirname(root))) || 'memory',
      root,
      rootIsMemory: true,
      slots: [makeSlot('memory', root, 'dir')],
    }
  }

  const slots: DiscoveredSlot[] = []
  for (const { item, kind } of VOCABULARY) {
    const path = join(root, item)
    if (isSecretExcluded(path)) continue // defense in depth (none of the vocabulary is secret)
    const st = await statOrNull(path)
    if (!st) continue
    if (kind === 'dir' && !st.isDirectory()) continue
    if (kind === 'file' && !st.isFile()) continue
    slots.push(makeSlot(item, path, kind))
  }
  return { projectName: slug(basename(root)) || 'memory', root, rootIsMemory: false, slots }
}

// ── Bulk scan of ~/.claude/projects ─────────────────────────────────────────

const SAFE_NAME = /^[A-Za-z0-9._-]+$/

/**
 * Recovers a human-friendly project name from a Claude project-dir slug. Claude
 * encodes the cwd by replacing every `/` with `-`, which is lossy (a literal `-`
 * in a path segment is indistinguishable from a separator). So we reconstruct the
 * real path by probing the filesystem: greedily take the shortest prefix of the
 * remaining tokens that names an existing directory, appending the next token with
 * `-` when it doesn't. Returns the last real path segment (e.g. `zimbify-core`,
 * not `core`). `dirExists` is injected for testing; the caller passes a `statSync`
 * probe. Falls back to the last `-`-token when the encoded path no longer exists.
 */
export function decodeClaudeProjectDir(slug: string, dirExists: (path: string) => boolean): string {
  const tokens = slug.replace(/^-+/, '').split('-').filter(Boolean)
  if (tokens.length === 0) return slug
  const segments: string[] = []
  let base = ''
  let i = 0
  let ok = true
  while (i < tokens.length) {
    let seg = tokens[i]
    let j = i
    while (!dirExists(`${base}/${seg}`)) {
      if (j + 1 < tokens.length) {
        j++
        seg = `${seg}-${tokens[j]}`
      } else {
        ok = false
        break
      }
    }
    if (!ok) break
    base = `${base}/${seg}`
    segments.push(seg)
    i = j + 1
  }
  if (ok && segments.length > 0) return segments[segments.length - 1]
  return tokens[tokens.length - 1] // fallback: the cwd no longer exists on disk
}

export interface ScannedProject {
  /** ~/.claude/projects/<slug> */
  dir: string
  /** the encoded basename of `dir` */
  slug: string
  /** decoded + deduped + safe project name (an editable seed) */
  suggestedName: string
  /** true when the recognizer found at least one source under `dir` */
  hasMemory: boolean
  /** join(dir, 'memory') — the folder an "activate memory" action would create */
  memoryPath: string
  proposal: DiscoveryProposal
  /** every recognized slot already has a path synced on this machine */
  alreadySyncedHere: boolean
  /**
   * The canonical name of the configured project this dir already belongs to
   * (by path collision), when `alreadySyncedHere`. This — not `suggestedName`,
   * which is decoded from Claude's per-machine slug — is what the UI shows for
   * a synced row.
   */
  syncedAs?: string
  /** this dir already corresponds to a project in the config (by path or name) */
  existsInConfig: boolean
}

/**
 * Scans `projectsRoot` (typically ~/.claude/projects), running the per-dir
 * recognizer on each immediate subdirectory. Read-only: returns a proposal list
 * the UI turns into a bulk-create checklist. Tolerant — a missing root yields [].
 */
export async function scanClaudeProjects(
  projectsRoot: string,
  config: Config,
  adapter: PlatformAdapter,
  machineId: string,
): Promise<ScannedProject[]> {
  let dirNames: string[]
  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true })
    dirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  const dirExists = (p: string): boolean => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  const used = new Set<string>()
  const out: ScannedProject[] = []
  for (const dirName of dirNames) {
    const dir = join(projectsRoot, dirName)
    const proposal = await discoverProjectSources(dir, config, adapter, machineId)
    const hasMemory = proposal.slots.length > 0
    let name = decodeClaudeProjectDir(dirName, dirExists)
    if (!SAFE_NAME.test(name)) name = slug(name) || slug(dirName) || 'project'
    let unique = name
    for (let n = 2; used.has(unique); n++) unique = `${name}-${n}`
    used.add(unique)
    const alreadySyncedHere = hasMemory && proposal.slots.every((s) => !!s.collision)
    // The canonical name comes from the colliding project (path-matched), never
    // from the decoded slug — Claude names its dirs per-machine, inconsistently.
    const ownerProject = proposal.slots.find((s) => s.collision?.project)?.collision?.project
    out.push({
      dir,
      slug: dirName,
      suggestedName: unique,
      hasMemory,
      memoryPath: join(dir, 'memory'),
      proposal,
      alreadySyncedHere,
      syncedAs: alreadySyncedHere ? ownerProject : undefined,
      // Known project by PATH (robust) OR by an exact derived-name key match.
      existsInConfig: ownerProject != null || Boolean(config.projects[unique]),
    })
  }
  return out
}

// ── Flow B: OS-aware cross-machine mapping ──────────────────────────────────

export type RemapStatus = 'ok' | 'missing' | 'notUnderHome' | 'noReference'

export interface RemapSlot {
  slot: string
  kind: SlotKind
  referenceMachine: string | null
  referencePath: string | null
  proposedPath: string | null
  exists: boolean
  status: RemapStatus
  alreadyConfigured: boolean
  /**
   * True when the reference path lives under the reference machine's
   * ~/.claude/projects. Claude names those dirs per-machine (the slug encodes the
   * absolute cwd), so the home-prefix remap is meaningless across machines — the
   * UI must have the user pick the local dir instead of trusting `proposedPath`.
   */
  claudeManaged: boolean
}

export interface MachineMappingProposal {
  projectName: string
  targetMachine: string
  slots: RemapSlot[]
}

/**
 * Translates a reference machine's absolute path to the target machine by
 * swapping the reference home prefix for the target home. Boundary-aware (same
 * technique as `pathsCollide`), so `/Users/xavier` is not treated as under
 * `/Users/x`. Returns null when `refPath` does not hang off `refHome`.
 */
export function remapPath(refPath: string, refHome: string, targetHome: string): string | null {
  if (refPath === refHome) return targetHome
  const prefix = refHome.endsWith(sep) ? refHome : refHome + sep
  if (!refPath.startsWith(prefix)) return null
  return join(targetHome, refPath.slice(prefix.length))
}

/** True when `refPath` is (under) the reference machine's ~/.claude/projects. Boundary-aware. */
function isUnderClaudeProjects(refPath: string, refHome: string): boolean {
  if (!refHome) return false
  const root = join(refHome, '.claude', 'projects')
  return refPath === root || refPath.startsWith(root + sep)
}

/**
 * Chooses which machine's path to remap from for a slot: among the machines that
 * have the slot (excluding the target), prefer a remappable same-OS machine, then
 * any remappable one, then the alphabetically-first candidate (so a reference path
 * is still shown for the manual fallback). Deterministic via sorted machineId.
 */
export function pickReference(
  config: Config,
  projectName: string,
  slot: string,
  targetMachineId: string,
): string | null {
  const folder = config.projects[projectName]?.folders[slot]
  if (!folder) return null
  const candidates = Object.keys(folder)
    .filter((id) => id !== targetMachineId)
    .sort()
  if (candidates.length === 0) return null
  const targetOs = config.machines[targetMachineId]?.os
  const remappable = candidates.filter((id) => {
    const home = config.machines[id]?.home
    return home != null && remapPath(folder[id], home, '/') != null
  })
  const sameOs = remappable.find((id) => config.machines[id]?.os === targetOs)
  return sameOs ?? remappable[0] ?? candidates[0]
}

/**
 * Builds the cross-machine adoption proposal for `projectName` on the target
 * machine: for each slot, remaps a reference path to the target home
 * (`adapter.home()`), checks whether it exists on disk, and reports a status the
 * UI can act on (ok / missing / notUnderHome / noReference). Read-only.
 */
export async function proposeMachineMapping(
  projectName: string,
  targetMachineId: string,
  config: Config,
  adapter: PlatformAdapter,
): Promise<MachineMappingProposal> {
  const targetHome = adapter.home()
  const slots: RemapSlot[] = []
  for (const slot of projectSlots(config, projectName)) {
    const kind = projectSlotKind(config, projectName, slot)
    const alreadyConfigured = projectSlotPath(config, projectName, slot, targetMachineId) != null
    const ref = pickReference(config, projectName, slot, targetMachineId)
    if (!ref) {
      slots.push({
        slot,
        kind,
        referenceMachine: null,
        referencePath: null,
        proposedPath: null,
        exists: false,
        status: 'noReference',
        alreadyConfigured,
        claudeManaged: false,
      })
      continue
    }
    const referencePath = config.projects[projectName].folders[slot][ref]
    const refHome = config.machines[ref]?.home ?? ''
    const claudeManaged = isUnderClaudeProjects(referencePath, refHome)
    const proposedPath = remapPath(referencePath, refHome, targetHome)
    if (proposedPath == null) {
      slots.push({
        slot,
        kind,
        referenceMachine: ref,
        referencePath,
        proposedPath: null,
        exists: false,
        status: 'notUnderHome',
        alreadyConfigured,
        claudeManaged,
      })
      continue
    }
    const exists = (await statOrNull(proposedPath)) != null
    slots.push({
      slot,
      kind,
      referenceMachine: ref,
      referencePath,
      proposedPath,
      exists,
      status: exists ? 'ok' : 'missing',
      alreadyConfigured,
      claudeManaged,
    })
  }
  return { projectName, targetMachine: targetMachineId, slots }
}
