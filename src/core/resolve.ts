import { join, resolve as resolvePath, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
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
  exclude?: { project: string; slot: string },
): SyncedPath[] {
  const out: SyncedPath[] = []
  for (const [projectName, project] of Object.entries(config.projects)) {
    for (const [slot, folder] of Object.entries(project.folders)) {
      if (exclude && exclude.project === projectName && exclude.slot === slot) continue
      const p = folder[machineId]
      if (p) out.push({ path: p, where: `${projectName}/${slot}` })
    }
  }
  for (const item of userLevelItems(adapter)) {
    if (item.kind === 'dir') out.push({ path: item.realPath, where: `~/.claude/${item.slot}` })
  }
  return out
}
