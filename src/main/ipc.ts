import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { createPlatformAdapter } from '../platform'
import { AppError, encodeAppError } from '../core/errors'
import { folderContainsMemoryIndex } from '../core/memoryScan'
import * as notebook from '../core/notebook'
import { PlanDriftError } from '../core/plan'
import { runPreflight } from '../core/preflight'
import { withRepoLock } from '../core/repoLock'
import { isRepoReleaseUrl } from '../core/releaseCheck'
import * as svc from '../core/service'
import type { AutoSyncPrefs, Plan, Verb } from '../core/types'
import type { SyncScheduler } from './syncScheduler'
import type { UpdateScheduler } from './updateScheduler'

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
      // Attach the original as `cause` so the error chain survives locally;
      // only Error.message crosses the IPC boundary, so the wire format is unchanged.
      if (e instanceof AppError) throw new Error(encodeAppError(e), { cause: e })
      throw e
    }
  })
}

export function registerIpc(
  scheduler: SyncScheduler,
  updateScheduler: UpdateScheduler,
  canMutate: () => boolean = () => true,
): void {
  /**
   * A handler that changes the working copy, the shared config or local state. While
   * another process owns this machine's sync lock (#141) it's refused, so a second
   * copy can look but never write over the one that's syncing.
   */
  function change<A extends unknown[], R>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>,
  ): void {
    handle<A, R>(channel, (event, ...args: A) => {
      if (!canMutate()) {
        throw new AppError(
          'instance.busy',
          'Another copy of the app (or a command-line sync) is syncing this machine right now. This one can make changes once it closes.',
        )
      }
      return fn(event, ...args)
    })
  }

  /** A Notebook mutation commits to the working copy: let the engine count/upload it (#139). */
  function notebookChange<A extends unknown[], R>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>,
  ): void {
    change<A, R>(channel, async (event, ...args: A) => {
      const r = await fn(event, ...args)
      scheduler.onWorkingCopyCommit()
      return r
    })
  }

  handle('app:version', () => app.getVersion())
  handle('preflight:run', () => runPreflight())
  handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(text)
  })
  handle('project:folderHasMemoryIndex', (_e, p: { path: string; kind: 'file' | 'dir' }) =>
    folderContainsMemoryIndex(adapter(), p.path, p.kind),
  )

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
  ipcMain.handle(
    'window:isMaximized',
    (_e) => !!BrowserWindow.fromWebContents(_e.sender)?.isMaximized(),
  )

  // Auto-sync engine (real-time state via webContents.send('sync:state'))
  handle('sync:getState', () => scheduler.getState())
  change('sync:setAuto', (_e, prefs: AutoSyncPrefs) => scheduler.setAuto(prefs))
  change('sync:now', () => scheduler.syncNow())

  // Update check (real-time state via webContents.send('update:state'), #66).
  // openReleasePage just hands the URL to the OS default browser — no update is
  // downloaded or installed by the app itself. It now also opens an installer asset
  // (#134), so only https URLs inside this repo's GitHub releases are accepted.
  handle('update:getState', () => updateScheduler.getState())
  handle('update:openReleasePage', (_e, url: string) => {
    if (typeof url !== 'string' || !isRepoReleaseUrl(url)) {
      throw new AppError('update.invalidUrl', 'Refusing to open a URL outside the app releases.')
    }
    return shell.openExternal(url)
  })

  // Config / repo
  handle('config:load', () => svc.loadRepoConfig(adapter()).catch(() => null))
  change('repo:connect', (_e, remote: string) => svc.connectRepo(remote, adapter()))
  handle('repo:status', () => svc.repoStatus(adapter()))
  handle('repo:history', (_e, limit?: number) => svc.history(adapter(), limit))
  // Manual git mutations of the working copy share the auto-sync cycle's lock (#111).
  change('repo:pull', () => withRepoLock(() => svc.pullRepo(adapter())))

  // Machines
  change('machine:register', async (_e, name?: string) => {
    const r = await svc.registerMachine(adapter(), name)
    void scheduler.reload() // only now is there an identity ⇒ the engine can start
    return r
  })
  handle('machine:current', () => svc.currentMachineId(adapter()))

  // Projects
  change('project:create', (_e, name: string) => svc.createProject(adapter(), name))
  change(
    'project:setFolder',
    (_e, p: { name: string; slot: string; path: string; kind?: 'file' | 'dir' }) =>
      svc.setProjectFolder(adapter(), p.name, p.slot, p.path, undefined, p.kind),
  )
  change('project:removeFolder', (_e, p: { name: string; slot: string }) =>
    svc.removeProjectFolder(adapter(), p.name, p.slot),
  )
  change('project:delete', (_e, name: string) => svc.deleteProject(adapter(), name))
  change('project:rename', (_e, p: { oldName: string; newName: string }) =>
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
  // Native single-file picker, shared by project file-slots and pinned files.
  handle('path:pickFile', async () => {
    const a = adapter()
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      defaultPath: a.claudeHome(),
    })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })

  // Auto-discovery of project sources + OS-aware cross-machine adoption.
  handle('project:discover', (_e, dir: string) => svc.discoverProject(adapter(), dir))
  handle(
    'project:suggestFolderCorrection',
    (_e, p: { name: string; slot: string; path: string; kind: 'file' | 'dir' }) =>
      svc.suggestFolderCorrection(adapter(), p.name, p.slot, p.path, p.kind),
  )
  change('project:applyDiscovery', (_e, input: svc.ApplyDiscoveryInput) =>
    svc.applyDiscovery(adapter(), input),
  )
  handle('project:proposeAdoption', (_e, name: string) => svc.proposeAdoption(adapter(), name))
  change('project:applyMapping', (_e, input: svc.ApplyMachineMappingInput) =>
    svc.applyMachineMapping(adapter(), input),
  )
  handle('project:scan', () => svc.scanProjects(adapter()))
  change('project:applyScan', (_e, inputs: svc.ApplyDiscoveryInput[]) =>
    svc.applyScan(adapter(), inputs),
  )

  // File preview (Recent activity → open a file's content in a modal, #43).
  handle('file:preview', (_e, repoRelPath: string) => svc.filePreview(adapter(), repoRelPath))
  // Reveal the file's real source in the OS file manager. The path is re-derived
  // server-side from the repo-relative path, never taken from the renderer.
  handle('file:reveal', async (_e, repoRelPath: string) => {
    const path = await svc.resolveSourcePath(adapter(), repoRelPath)
    if (!path) {
      throw new AppError(
        'preview.sourceUnavailable',
        'This file has no source on this machine to open.',
      )
    }
    shell.showItemInFolder(path)
    return true
  })

  // Notebook (#104): cloud-native notes/prompts. Mutations commit locally (no push);
  // the normal sync cycle pushes them later. Paths are validated server-side.
  handle('notebook:tree', () => notebook.notebookTree(adapter()))
  handle('notebook:read', (_e, rel: string) => notebook.readNote(adapter(), rel))
  notebookChange('notebook:createNote', (_e, p: { relPath: string; content?: string }) =>
    notebook.createNote(adapter(), p),
  )
  notebookChange('notebook:write', (_e, p: { relPath: string; content: string }) =>
    notebook.writeNote(adapter(), p),
  )
  notebookChange('notebook:createFolder', (_e, rel: string) =>
    notebook.createFolder(adapter(), rel),
  )
  notebookChange('notebook:rename', (_e, p: { relPath: string; newName: string }) =>
    notebook.renameEntry(adapter(), p),
  )
  notebookChange('notebook:move', (_e, p: { relPath: string; toDir: string }) =>
    notebook.moveEntry(adapter(), p),
  )
  notebookChange('notebook:delete', (_e, rel: string) => notebook.deleteEntry(adapter(), rel))
  // Version history (#107): read-only git lookups + a restore that commits locally
  // like a Save. The hash and the path-at-commit are validated server-side.
  handle('notebook:history', (_e, rel: string) => notebook.noteHistory(adapter(), rel))
  handle('notebook:readVersion', (_e, p: { hash: string; path: string }) =>
    notebook.readNoteVersion(adapter(), p),
  )
  handle('notebook:diffVersion', (_e, p: { relPath: string; hash: string; path: string }) =>
    notebook.diffNoteVersion(adapter(), p),
  )
  notebookChange(
    'notebook:restoreVersion',
    (_e, p: { relPath: string; hash: string; path: string }) =>
      notebook.restoreNoteVersion(adapter(), p),
  )
  // Full-text search (#108) over the working copy's Notebook.
  handle('notebook:search', (_e, p: { query: string; limit?: number }) =>
    notebook.searchNotebook(adapter(), p),
  )

  // Pinned files (global pinpoint files, outside any project)
  change('pinned:set', (_e, p: { pinId: string; path: string }) =>
    svc.setPinnedFile(adapter(), p.pinId, p.path),
  )
  change('pinned:remove', (_e, pinId: string) => svc.removePinnedFile(adapter(), pinId))

  // Plan
  handle('plan:build', async (_e, verb: Verb) => {
    const plan = await svc.buildVerbPlan(adapter(), verb, meta())
    planCache.set(plan.id, plan)
    return plan
  })
  change('plan:execute', async (_e, args: { verb: Verb; planId: string; force?: boolean }) => {
    const plan = planCache.get(args.planId)
    if (!plan) {
      throw new AppError(
        'plan.expired',
        'Plan expired; rebuild it (the preview is no longer valid).',
      )
    }
    const opts = { force: args.force }
    try {
      const result = await withRepoLock(() =>
        args.verb === 'outgoing'
          ? svc.syncOutgoing(adapter(), plan, opts)
          : svc.syncIncoming(adapter(), plan, opts),
      )
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
  change('conflict:resolve', (_e, a: { file: string; side: 'local' | 'remote' }) =>
    withRepoLock(() => svc.resolveConflict(adapter(), a.file, a.side)),
  )
  change('conflict:complete', async () => {
    // Not nested: resumeAfterConflict takes the lock itself, after this one is released.
    const r = await withRepoLock(() => svc.completeConflictMerge(adapter()))
    await scheduler.resumeAfterConflict() // pull the resolved merge and resume auto
    return r
  })
}
