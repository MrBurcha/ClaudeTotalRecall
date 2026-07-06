import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { createPlatformAdapter } from '../platform'
import { loadSettingsLocal, saveSettingsLocal } from '../core/localState'
import { runPreflight } from '../core/preflight'
import * as svc from '../core/service'
import type { Plan, SettingsObject, Verb } from '../core/types'

/**
 * Caché de Plans previsualizados: plan:execute recibe un planId y ejecuta el
 * Plan exacto que el usuario confirmó. La revalidación TOCTOU dentro de
 * executePlan aborta si el disco cambió desde el build.
 */
const planCache = new Map<string, Plan>()

function adapter() {
  return createPlatformAdapter()
}
function meta(): { id: string; createdAt: string } {
  return { id: randomUUID(), createdAt: new Date().toISOString() }
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('preflight:run', () => runPreflight())

  // Config / repo
  ipcMain.handle('config:load', () => svc.loadRepoConfig(adapter()).catch(() => null))
  ipcMain.handle('repo:connect', (_e, remote: string) => svc.connectRepo(remote, adapter()))
  ipcMain.handle('repo:status', () => svc.repoStatus(adapter()))
  ipcMain.handle('repo:pull', () => svc.pullRepo(adapter()))

  // Máquinas
  ipcMain.handle('machine:register', (_e, name?: string) => svc.registerMachine(adapter(), name))
  ipcMain.handle('machine:current', () => svc.currentMachineId(adapter()))

  // Proyectos
  ipcMain.handle('project:create', (_e, name: string) => svc.createProject(adapter(), name))
  ipcMain.handle(
    'project:setFolder',
    (_e, p: { name: string; slot: string; path: string }) =>
      svc.setProjectFolder(adapter(), p.name, p.slot, p.path),
  )
  ipcMain.handle('project:removeFolder', (_e, p: { name: string; slot: string }) =>
    svc.removeProjectFolder(adapter(), p.name, p.slot),
  )
  ipcMain.handle('project:delete', (_e, name: string) => svc.deleteProject(adapter(), name))
  ipcMain.handle('project:pickFolder', async () => {
    const a = adapter()
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: join(a.claudeHome(), 'projects'),
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // Plan
  ipcMain.handle('plan:build', async (_e, verb: Verb) => {
    const plan = await svc.buildVerbPlan(adapter(), verb, meta())
    planCache.set(plan.id, plan)
    return plan
  })
  ipcMain.handle('plan:execute', async (_e, args: { verb: Verb; planId: string }) => {
    const plan = planCache.get(args.planId)
    if (!plan) throw new Error('Plan expirado; reconstruilo (el preview ya no es válido).')
    const res =
      args.verb === 'gather'
        ? await svc.syncGather(adapter(), plan)
        : await svc.syncScatter(adapter(), plan)
    planCache.delete(args.planId)
    return res
  })

  // Conflictos
  ipcMain.handle('conflict:list', () => svc.listConflicts(adapter()))
  ipcMain.handle('conflict:resolve', (_e, a: { file: string; side: 'local' | 'remote' }) =>
    svc.resolveConflict(adapter(), a.file, a.side),
  )
  ipcMain.handle('conflict:complete', () => svc.completeConflictMerge(adapter()))

  // settings.local.json
  ipcMain.handle('settingsLocal:load', () => loadSettingsLocal(adapter()))
  ipcMain.handle('settingsLocal:save', (_e, obj: SettingsObject) =>
    saveSettingsLocal(adapter(), obj),
  )
}
