import { join, resolve as resolvePath, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { parseMemoryPath } from './memoryPath'
import type { Config } from './types'

export interface UserLevelItem {
  slot: string
  realPath: string
  logicalPath: string
  kind: 'file' | 'dir'
}

/**
 * Ranuras user-level fijas. `logicalPath` es relativo a la raíz del repo;
 * `realPath` se expande contra ~/.claude vía el adapter.
 */
const USER_LEVEL_SPEC: ReadonlyArray<{ slot: string; kind: 'file' | 'dir' }> = [
  { slot: 'CLAUDE.md', kind: 'file' },
  { slot: 'commands', kind: 'dir' },
  { slot: 'agents', kind: 'dir' },
  { slot: 'skills', kind: 'dir' },
  { slot: 'settings.json', kind: 'file' },
]

export function userLevelItems(adapter: PlatformAdapter): UserLevelItem[] {
  const claudeHome = adapter.claudeHome()
  return USER_LEVEL_SPEC.map(({ slot, kind }) => ({
    slot,
    realPath: join(claudeHome, slot),
    logicalPath: `memories/user/${slot}`,
    kind,
  }))
}

/**
 * Path absoluto literal de una ranura de proyecto para una máquina, o null si
 * el proyecto, la ranura o el machineId no están mapeados.
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

/** Nombres de ranuras del proyecto, [] si no existe. */
export function projectSlots(config: Config, projectName: string): string[] {
  const project = config.projects[projectName]
  if (!project) return []
  return Object.keys(project.folders)
}

/** logicalPath en el repo para una ranura de proyecto. */
export function projectSlotLogicalPath(projectName: string, slot: string): string {
  return `memories/projects/${projectName}/${slot}`
}

/** Tipo de una ranura de proyecto: archivo puntual vs carpeta espejada (default 'dir'). */
export function projectSlotKind(config: Config, projectName: string, slot: string): 'file' | 'dir' {
  return config.projects[projectName]?.slotKinds?.[slot] ?? 'dir'
}

/** Un archivo fijado global mapeado para una máquina. */
export interface PinnedFileItem {
  pinId: string
  /** ruta absoluta literal en esta máquina (ya expandida al guardarse) */
  realPath: string
  /** logicalPath en el repo (memories/pinned/<pinId>) */
  logicalPath: string
}

/** Archivos fijados globales que tienen ruta en `machineId` (siempre kind 'file'). */
export function pinnedFileItems(config: Config, machineId: string): PinnedFileItem[] {
  const out: PinnedFileItem[] = []
  for (const [pinId, byMachine] of Object.entries(config.pinnedFiles ?? {})) {
    const p = byMachine[machineId]
    if (p) out.push({ pinId, realPath: p, logicalPath: `memories/pinned/${pinId}` })
  }
  return out
}

/**
 * True si dos paths absolutos son el mismo o uno está anidado dentro del otro.
 * Normaliza ambos (colapsa `.`/`..`/trailing slash con `resolve`) y compara en el
 * LÍMITE del separador, así `/tmp/ab` NO colisiona con `/tmp/abc`. Case-sensitive.
 */
export function pathsCollide(a: string, b: string): boolean {
  const na = resolvePath(a)
  const nb = resolvePath(b)
  if (na === nb) return true
  const aPrefix = na.endsWith(sep) ? na : na + sep
  const bPrefix = nb.endsWith(sep) ? nb : nb + sep
  return nb.startsWith(aPrefix) || na.startsWith(bPrefix)
}

/** Un path ya sincronizado en una máquina, con una etiqueta para el mensaje de error. */
export interface SyncedPath {
  path: string
  where: string
  /** Nombre canónico del proyecto dueño, si el path proviene de una ranura de proyecto. */
  project?: string
}

/**
 * Todos los paths que YA sincroniza `machineId`: las ranuras de proyecto de esa
 * máquina (excepto el `exclude` que se está editando, para no auto-colisionar) más
 * los roots dir user-level (`~/.claude/{commands,agents,skills}`, que se sincronizan
 * recursivos). Base para el chequeo anti-anidamiento de `setProjectFolder`.
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
