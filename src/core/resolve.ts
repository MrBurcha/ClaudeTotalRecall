import { join } from 'node:path'
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
