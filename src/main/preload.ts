import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  Config,
  Plan,
  PlanAction,
  PreflightResult,
  RepoStatus,
  SettingsObject,
  SyncEngineState,
  Verb,
} from '../core/types'
import type {
  ConnectResult,
  CreateProjectResult,
  GatherResult,
  RegisterResult,
  ScatterResult,
} from '../core/service'

/**
 * Resultado de ejecutar un Plan. Si el disco cambió desde el preview, el core
 * tira PlanDriftError; el handler lo mapea a `{ ok:false, drift:true, drifted }`
 * porque Electron solo serializa `message` de un throw (perdería `drifted`).
 * El plan queda cacheado por su id → "Forzar" re-ejecuta con el mismo planId.
 */
export type ExecOutcome =
  | { ok: true; result: GatherResult | ScatterResult }
  | { ok: false; drift: true; drifted: PlanAction[] }

/**
 * El ÚNICO puente renderer ↔ main. El renderer nunca toca fs/child_process:
 * todo pasa por estos canales tipados (superficie IPC §15).
 */
const api = {
  appVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  preflightRun: () => ipcRenderer.invoke('preflight:run') as Promise<PreflightResult>,

  configLoad: () => ipcRenderer.invoke('config:load') as Promise<Config | null>,
  repoConnect: (remote: string) =>
    ipcRenderer.invoke('repo:connect', remote) as Promise<ConnectResult>,
  repoStatus: () => ipcRenderer.invoke('repo:status') as Promise<RepoStatus>,
  repoPull: () =>
    ipcRenderer.invoke('repo:pull') as Promise<{ ok: boolean; conflicts: string[] }>,

  machineRegister: (name?: string) =>
    ipcRenderer.invoke('machine:register', name) as Promise<RegisterResult>,
  machineCurrent: () => ipcRenderer.invoke('machine:current') as Promise<string | null>,

  projectCreate: (name: string) =>
    ipcRenderer.invoke('project:create', name) as Promise<CreateProjectResult>,
  projectSetFolder: (name: string, slot: string, path: string) =>
    ipcRenderer.invoke('project:setFolder', { name, slot, path }) as Promise<void>,
  projectRemoveFolder: (name: string, slot: string) =>
    ipcRenderer.invoke('project:removeFolder', { name, slot }) as Promise<void>,
  projectDelete: (name: string) => ipcRenderer.invoke('project:delete', name) as Promise<void>,
  projectPickFolder: () => ipcRenderer.invoke('project:pickFolder') as Promise<string | null>,

  planBuild: (verb: Verb) => ipcRenderer.invoke('plan:build', verb) as Promise<Plan>,
  planExecute: (verb: Verb, planId: string, force?: boolean) =>
    ipcRenderer.invoke('plan:execute', { verb, planId, force }) as Promise<ExecOutcome>,

  conflictList: () => ipcRenderer.invoke('conflict:list') as Promise<string[]>,
  conflictResolve: (file: string, side: 'local' | 'remote') =>
    ipcRenderer.invoke('conflict:resolve', { file, side }) as Promise<void>,
  conflictComplete: () =>
    ipcRenderer.invoke('conflict:complete') as Promise<{ pushed: boolean }>,

  settingsLocalLoad: () => ipcRenderer.invoke('settingsLocal:load') as Promise<SettingsObject>,
  settingsLocalSave: (obj: SettingsObject) =>
    ipcRenderer.invoke('settingsLocal:save', obj) as Promise<void>,

  // Auto-sync: estado actual (pull), cambio de prefs, disparo manual, y la
  // suscripción al push en tiempo real (devuelve una función para desuscribirse).
  syncGetState: () => ipcRenderer.invoke('sync:getState') as Promise<SyncEngineState>,
  syncSetAuto: (enabled: boolean, intervalMs: number) =>
    ipcRenderer.invoke('sync:setAuto', { enabled, intervalMs }) as Promise<SyncEngineState>,
  syncNow: () => ipcRenderer.invoke('sync:now') as Promise<SyncEngineState>,
  onSyncState: (cb: (state: SyncEngineState) => void) => {
    const listener = (_e: IpcRendererEvent, state: SyncEngineState) => cb(state)
    ipcRenderer.on('sync:state', listener)
    return () => {
      ipcRenderer.removeListener('sync:state', listener)
    }
  },

  // Ventana (barra de título custom, frameless): controles + estado maximizado en
  // vivo. `platform` deja que el renderer decida si dibuja botones propios (Linux/
  // Windows) o cede a los semáforos nativos (macOS).
  windowMinimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  windowMaximize: () => ipcRenderer.invoke('window:maximize') as Promise<boolean>,
  windowClose: () => ipcRenderer.invoke('window:close') as Promise<void>,
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
  onWindowState: (cb: (maximized: boolean) => void) => {
    const listener = (_e: IpcRendererEvent, maximized: boolean) => cb(maximized)
    ipcRenderer.on('window:state', listener)
    return () => {
      ipcRenderer.removeListener('window:state', listener)
    }
  },
  platform: process.platform,
}

export type ClaudeTrApi = typeof api

contextBridge.exposeInMainWorld('claudetr', api)
