import type { Config } from '../../../core/types'
import { api } from '../../state/api'
import type { PinnedTarget } from './pinnedGroups'

/**
 * Sets THIS machine's path for a pinned file, through the existing APIs: a General
 * file is a global pin (`pinned:set`); a project file is a file-kind slot
 * (`project:setFolder` with kind 'file', which also creates the slot if missing).
 */
export function savePinnedPath(target: PinnedTarget, name: string, path: string): Promise<void> {
  return target.scope === 'general'
    ? api.pinnedSet(name, path)
    : api.projectSetFolder(target.project, name, path, 'file')
}

/**
 * Same check as the Projects folder editor: saving a project source that carries a
 * MEMORY.md, while the project already lives on another machine, may leave the index
 * out of sync — the caller then offers the memory-maintenance pass. Never throws.
 */
export async function needsMemoryHelp(
  config: Config | null,
  machineId: string | null,
  target: PinnedTarget,
  path: string,
): Promise<boolean> {
  if (target.scope !== 'project') return false
  const onOtherMachine = Object.values(config?.projects[target.project]?.folders ?? {}).some(
    (byMachine) => Object.keys(byMachine).some((m) => m !== machineId),
  )
  if (!onOtherMachine) return false
  return api.projectFolderHasMemoryIndex(path, 'file').catch(() => false)
}
