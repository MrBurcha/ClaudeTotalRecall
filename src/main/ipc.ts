import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createPlatformAdapter } from '../platform'
import { AppError, encodeAppError } from '../core/errors'
import { PlanDriftError } from '../core/plan'
import { runPreflight } from '../core/preflight'
import * as svc from '../core/service'
import type { AutoSyncPrefs, Plan, Verb } from '../core/types'
import type { SyncScheduler } from './syncScheduler'

/**
 * Cache of previewed Plans: plan:execute receives a planId and runs the exact Plan
 * the user confirmed. The TOCTOU revalidation inside executePlan aborts if the disk
 * changed since the build.
 */
const planCache = new Map<string, Plan>()

function adapter() {
  return createPlatformAdapter()
}
function meta(): { id: string; createdAt: string } {
  return { id: randomUUID(), createdAt: new Date().toISOString() }
}

/**
 * Registers an IPC handler that lets AppError cross the boundary with its code and
 * params intact. Electron only serializes Error.message over ipcMain.handle, so we
 * smuggle the structured error inside the message behind a sentinel; the renderer
 * (normalizeError) decodes and localizes it. Non-AppError rejections pass through.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...(args as A))
    } catch (e) {
      if (e instanceof AppError) throw new Error(encodeAppError(e))
      throw e
    }
  })
}

export function registerIpc(scheduler: SyncScheduler): void {
  handle('app:version', () => app.getVersion())
  handle('preflight:run', () => runPreflight())

  // Window: custom (frameless) title-bar controls. The window is resolved from the
  // sender, without relying on a global reference. These never throw AppError, so
  // they use raw ipcMain.handle.
  ipcMain.handle('window:minimize', (_e) => BrowserWindow.fromWebContents(_e.sender)?.minimize())
  ipcMain.handle('window:maximize', (_e) => {
    const w = BrowserWindow.fromWebContents(_e.sender)
    if (w?.isMaximized()) w.unmaximize()
    else w?.maximize()
    return !!w?.isMaximized()
  })
  ipcMain.handle('window:close', (_e) => BrowserWindow.fromWebContents(_e.sender)?.close())
  ipcMain.handle('window:isMaximized', (_e) =>
    !!BrowserWindow.fromWebContents(_e.sender)?.isMaximized(),
  )

  // Auto-sync engine (real-time state via webContents.send('sync:state'))
  handle('sync:getState', () => scheduler.getState())
  handle('sync:setAuto', (_e, prefs: AutoSyncPrefs) => scheduler.setAuto(prefs))
  handle('sync:now', () => scheduler.syncNow())

  // Config / repo
  handle('config:load', () => svc.loadRepoConfig(adapter()).catch(() => null))
  handle('repo:connect', (_e, remote: string) => svc.connectRepo(remote, adapter()))
  handle('repo:status', () => svc.repoStatus(adapter()))
  handle('repo:pull', () => svc.pullRepo(adapter()))

  // Machines
  handle('machine:register', async (_e, name?: string) => {
    const r = await svc.registerMachine(adapter(), name)
    void scheduler.reload() // only now is there an identity ⇒ the engine can start
    return r
  })
  handle('machine:current', () => svc.currentMachineId(adapter()))

  // Projects
  handle('project:create', (_e, name: string) => svc.createProject(adapter(), name))
  handle('project:setFolder', (_e, p: { name: string; slot: string; path: string }) =>
    svc.setProjectFolder(adapter(), p.name, p.slot, p.path),
  )
  handle('project:removeFolder', (_e, p: { name: string; slot: string }) =>
    svc.removeProjectFolder(adapter(), p.name, p.slot),
  )
  handle('project:delete', (_e, name: string) => svc.deleteProject(adapter(), name))
  handle('project:rename', (_e, p: { oldName: string; newName: string }) =>
    svc.renameProject(adapter(), p.oldName, p.newName),
  )
  handle('project:pickFolder', async () => {
    const a = adapter()
    const r = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: join(a.claudeHome(), 'projects'),
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // Plan
  handle('plan:build', async (_e, verb: Verb) => {
    const plan = await svc.buildVerbPlan(adapter(), verb, meta())
    planCache.set(plan.id, plan)
    return plan
  })
  handle('plan:execute', async (_e, args: { verb: Verb; planId: string; force?: boolean }) => {
    const plan = planCache.get(args.planId)
    if (!plan) {
      throw new AppError('plan.expired', 'Plan expired; rebuild it (the preview is no longer valid).')
    }
    const opts = { force: args.force }
    try {
      const result =
        args.verb === 'gather'
          ? await svc.syncGather(adapter(), plan, opts)
          : await svc.syncScatter(adapter(), plan, opts)
      planCache.delete(args.planId) // only consumed after success
      return { ok: true, result }
    } catch (e) {
      // Drift: map the typed error to a serializable shape (the plan stays cached so
      // "Force" can reuse the same planId). Everything else re-throws.
      if (e instanceof PlanDriftError) return { ok: false, drift: true, drifted: e.drifted }
      throw e
    }
  })

  // Conflicts
  handle('conflict:list', () => svc.listConflicts(adapter()))
  handle('conflict:resolve', (_e, a: { file: string; side: 'local' | 'remote' }) =>
    svc.resolveConflict(adapter(), a.file, a.side),
  )
  handle('conflict:complete', async () => {
    const r = await svc.completeConflictMerge(adapter())
    await scheduler.resumeAfterConflict() // pull the resolved merge and resume auto
    return r
  })
}
