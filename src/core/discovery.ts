import { stat } from 'node:fs/promises'
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
  collision?: { with: string; where: string }
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
      if (pathsCollide(path, sp.path)) return { with: sp.path, where: sp.where }
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
      })
      continue
    }
    const referencePath = config.projects[projectName].folders[slot][ref]
    const refHome = config.machines[ref]?.home ?? ''
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
    })
  }
  return { projectName, targetMachine: targetMachineId, slots }
}
