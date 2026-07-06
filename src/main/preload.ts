import { contextBridge, ipcRenderer } from 'electron'
import type { Config, Plan, PreflightResult, RepoStatus, SettingsObject, Verb } from '../core/types'
import type {
  ConnectResult,
  GatherResult,
  RegisterResult,
  ScatterResult,
} from '../core/service'

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

  projectCreate: (name: string) => ipcRenderer.invoke('project:create', name) as Promise<void>,
  projectSetFolder: (name: string, slot: string, path: string) =>
    ipcRenderer.invoke('project:setFolder', { name, slot, path }) as Promise<void>,
  projectRemoveFolder: (name: string, slot: string) =>
    ipcRenderer.invoke('project:removeFolder', { name, slot }) as Promise<void>,
  projectDelete: (name: string) => ipcRenderer.invoke('project:delete', name) as Promise<void>,
  projectPickFolder: () => ipcRenderer.invoke('project:pickFolder') as Promise<string | null>,

  planBuild: (verb: Verb) => ipcRenderer.invoke('plan:build', verb) as Promise<Plan>,
  planExecute: (verb: Verb, planId: string) =>
    ipcRenderer.invoke('plan:execute', { verb, planId }) as Promise<GatherResult | ScatterResult>,

  conflictList: () => ipcRenderer.invoke('conflict:list') as Promise<string[]>,
  conflictResolve: (file: string, side: 'local' | 'remote') =>
    ipcRenderer.invoke('conflict:resolve', { file, side }) as Promise<void>,
  conflictComplete: () =>
    ipcRenderer.invoke('conflict:complete') as Promise<{ pushed: boolean }>,

  settingsLocalLoad: () => ipcRenderer.invoke('settingsLocal:load') as Promise<SettingsObject>,
  settingsLocalSave: (obj: SettingsObject) =>
    ipcRenderer.invoke('settingsLocal:save', obj) as Promise<void>,
}

export type ClaudeTrApi = typeof api

contextBridge.exposeInMainWorld('claudetr', api)
