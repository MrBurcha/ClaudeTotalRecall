import { mkdir, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { loadConfig, saveConfig } from './config'
import { Git } from './git'
import { ensureSettingsLocal, loadLocalState, loadSettingsLocal, saveLocalState } from './localState'
import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import { emptyConfig, type Config, type Machine, type Plan, type RepoStatus, type Verb } from './types'

// ── ubicaciones locales (working copy = clon del repo bajo configHome) ───────
export function workingCopyDir(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'repo')
}
export function configPath(adapter: PlatformAdapter): string {
  return join(workingCopyDir(adapter), 'claudetr.json')
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export function loadRepoConfig(adapter: PlatformAdapter): Promise<Config> {
  return loadConfig(configPath(adapter))
}

/** Asegura una identidad de commit local si el usuario no tiene una global. */
async function ensureIdentity(git: Git): Promise<void> {
  const email = await git.raw(['config', 'user.email'])
  if (email.code !== 0 || !email.stdout.trim()) {
    await git.config('user.email', 'claudetr@localhost')
    await git.config('user.name', 'ClaudeTR')
  }
}

// ── onboarding: conectar al repo (clona; inicializa estructura si está vacío) ─
export interface ConnectResult {
  initialized: boolean
}

async function initStructure(dir: string, remote: string): Promise<void> {
  await saveConfig(join(dir, 'claudetr.json'), emptyConfig(remote))
  const dirs = [
    'memories/user/commands',
    'memories/user/agents',
    'memories/user/skills',
    'memories/projects',
  ]
  for (const d of dirs) {
    await mkdir(join(dir, d), { recursive: true })
    await writeFile(join(dir, d, '.gitkeep'), '')
  }
  // Defensa en profundidad: aunque el guard del Plan ya excluye secretos.
  await writeFile(join(dir, '.gitignore'), '.DS_Store\n.credentials.json\n*.jsonl\n.claude.json\n')
}

export async function connectRepo(
  remote: string,
  adapter: PlatformAdapter,
): Promise<ConnectResult> {
  const dir = workingCopyDir(adapter)
  await mkdir(adapter.configHome(), { recursive: true })

  let git: Git
  if (await pathExists(join(dir, '.git'))) {
    git = new Git(dir)
    await git.fetch()
  } else {
    git = await Git.clone(remote, dir)
  }
  await ensureIdentity(git)

  if (!(await pathExists(configPath(adapter)))) {
    await initStructure(dir, remote)
    await git.add()
    await git.commit('ClaudeTR: estructura inicial')
    await git.push(['-u', 'origin', 'HEAD'])
    return { initialized: true }
  }
  return { initialized: false }
}

// ── registro de máquina (fetch+reset+reapply: sin conflictos de merge en JSON) ─
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface RegisterResult {
  machineId: string
  machine: Machine
  alreadyRegistered: boolean
}

export async function registerMachine(
  adapter: PlatformAdapter,
  name?: string,
): Promise<RegisterResult> {
  const dir = workingCopyDir(adapter)
  const git = new Git(dir)
  await ensureIdentity(git)
  const machineId = slug(name ?? hostname())
  if (!machineId) throw new Error('Nombre de máquina inválido')
  const machine: Machine = { os: adapter.os(), hostname: hostname(), home: adapter.home() }

  let alreadyRegistered = false
  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await git.fetch()
    const branch = await git.currentBranch()
    // Re-aplico siempre sobre el estado remoto más reciente ⇒ el mapa de máquinas
    // nunca entra en conflicto textual aunque otra máquina registre en paralelo.
    await git.resetHard(`origin/${branch}`)

    const config = await loadRepoConfig(adapter)
    const existing = config.machines[machineId]
    if (existing && JSON.stringify(existing) === JSON.stringify(machine)) {
      alreadyRegistered = true
      break
    }
    config.machines[machineId] = machine
    await saveConfig(configPath(adapter), config)
    await git.add()
    await git.commit(`ClaudeTR: registrar máquina ${machineId}`)
    const push = await git.push()
    if (push.ok) break
    if (!push.rejected) throw new Error(`push falló al registrar: ${push.stderr}`)
    if (attempt === maxAttempts - 1) {
      throw new Error('No se pudo registrar tras varios reintentos (push rechazado)')
    }
  }

  await saveLocalState(adapter, { machineId })
  await ensureSettingsLocal(adapter)
  return { machineId, machine, alreadyRegistered }
}

// ── alta de proyecto / ranura (edita config en el repo, con retry) ───────────
async function commitConfigChange(
  adapter: PlatformAdapter,
  message: string,
  mutate: (config: Config) => void | Promise<void>,
): Promise<void> {
  const dir = workingCopyDir(adapter)
  const git = new Git(dir)
  await ensureIdentity(git)
  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await git.fetch()
    await git.resetHard(`origin/${await git.currentBranch()}`)
    const config = await loadRepoConfig(adapter)
    await mutate(config)
    await saveConfig(configPath(adapter), config)
    await git.add()
    const c = await git.commit(message)
    if (!c.committed) return
    const push = await git.push()
    if (push.ok) return
    if (!push.rejected) throw new Error(`push falló: ${push.stderr}`)
    if (attempt === maxAttempts - 1) throw new Error('No se pudo guardar tras varios reintentos')
  }
}

export async function currentMachineId(adapter: PlatformAdapter): Promise<string | null> {
  const local = await loadLocalState(adapter)
  return local?.machineId ?? null
}

// Los nombres de proyecto y ranura son claves de path en el repo
// (memories/projects/<name>/<slot>): validamos el charset y evitamos traversal.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/
function assertSafeName(kind: 'proyecto' | 'ranura', value: string): string {
  const v = value.trim()
  if (!SAFE_NAME.test(v) || /^\.+$/.test(v)) {
    throw new Error(
      `Nombre de ${kind} inválido: "${value}". Usá solo letras, números, punto, guion y guion bajo.`,
    )
  }
  return v
}

/** Crea un proyecto vacío (sin carpetas). Error si ya existe. */
export async function createProject(adapter: PlatformAdapter, name: string): Promise<void> {
  const proj = assertSafeName('proyecto', name)
  await commitConfigChange(adapter, `ClaudeTR: nuevo proyecto ${proj}`, (config) => {
    if (config.projects[proj]) throw new Error(`El proyecto "${proj}" ya existe.`)
    config.projects[proj] = { folders: {} }
  })
}

/**
 * Upsert del path literal de una ranura para ESTA máquina (crea proyecto/ranura
 * si faltan). Expande `~` y hace trim.
 */
export async function setProjectFolder(
  adapter: PlatformAdapter,
  projectName: string,
  slot: string,
  absolutePath: string,
  machineId?: string,
): Promise<void> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) throw new Error('Máquina no registrada; registrate antes de sumar proyectos.')
  const proj = assertSafeName('proyecto', projectName)
  const sl = assertSafeName('ranura', slot)
  const path = adapter.expandHome(absolutePath.trim())
  if (!path) throw new Error('El path no puede estar vacío.')
  await commitConfigChange(adapter, `ClaudeTR: ${proj}/${sl} en ${id}`, (config) => {
    const project = config.projects[proj] ?? { folders: {} }
    const folder = project.folders[sl] ?? {}
    folder[id] = path
    project.folders[sl] = folder
    config.projects[proj] = project
  })
}

/** Quita el path de ESTA máquina; si la ranura queda sin máquinas, la elimina. */
export async function removeProjectFolder(
  adapter: PlatformAdapter,
  projectName: string,
  slot: string,
  machineId?: string,
): Promise<void> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) throw new Error('Máquina no registrada.')
  await commitConfigChange(
    adapter,
    `ClaudeTR: quitar ${projectName}/${slot} en ${id}`,
    (config) => {
      const project = config.projects[projectName]
      const folder = project?.folders[slot]
      if (!folder) return
      delete folder[id]
      if (Object.keys(folder).length === 0) delete project.folders[slot]
    },
  )
}

/** Elimina un proyecto entero (todas las máquinas). */
export async function deleteProject(adapter: PlatformAdapter, projectName: string): Promise<void> {
  await commitConfigChange(adapter, `ClaudeTR: eliminar proyecto ${projectName}`, (config) => {
    delete config.projects[projectName]
  })
}

// ── conflictos ───────────────────────────────────────────────────────────────
export async function listConflicts(adapter: PlatformAdapter): Promise<string[]> {
  return new Git(workingCopyDir(adapter)).listConflicts()
}

export async function resolveConflict(
  adapter: PlatformAdapter,
  file: string,
  side: 'local' | 'remote',
): Promise<void> {
  const git = new Git(workingCopyDir(adapter))
  if (side === 'local') await git.checkoutOurs(file)
  else await git.checkoutTheirs(file)
}

/** Cierra el merge y, si puede, pushea. */
export async function completeConflictMerge(
  adapter: PlatformAdapter,
): Promise<{ pushed: boolean }> {
  const git = new Git(workingCopyDir(adapter))
  await git.completeMerge('ClaudeTR: resolución de conflictos')
  const push = await git.push()
  return { pushed: push.ok }
}

// ── status ────────────────────────────────────────────────────────────────
export function repoStatus(adapter: PlatformAdapter): Promise<RepoStatus> {
  return new Git(workingCopyDir(adapter)).status()
}

export async function pullRepo(
  adapter: PlatformAdapter,
): Promise<{ ok: boolean; conflicts: string[] }> {
  const r = await new Git(workingCopyDir(adapter)).pull()
  return { ok: r.ok, conflicts: r.conflicted }
}

// ── contexto de sync (config + identidad + overrides locales) ────────────────
async function buildContext(adapter: PlatformAdapter): Promise<SyncContext> {
  const config = await loadRepoConfig(adapter)
  const local = await loadLocalState(adapter)
  if (!local) {
    throw new Error('Máquina no registrada (falta local.json). Corré `claudetr register`.')
  }
  const localOverrides = await loadSettingsLocal(adapter)
  return {
    adapter,
    config,
    machineId: local.machineId,
    repoDir: workingCopyDir(adapter),
    localOverrides,
  }
}

export async function buildVerbPlan(
  adapter: PlatformAdapter,
  verb: Verb,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  return buildPlan(await buildContext(adapter), verb, meta)
}

// ── ejecución con git ────────────────────────────────────────────────────────
export interface GatherResult {
  exec: ExecResult
  conflicts: string[]
  pushed: boolean
  committed: boolean
}

/** Ejecuta gather (máquina → working copy) y sincroniza con el remoto. */
export async function syncGather(
  adapter: PlatformAdapter,
  plan: Plan,
  opts: { force?: boolean } = {},
): Promise<GatherResult> {
  const git = new Git(workingCopyDir(adapter))
  const ctx = await buildContext(adapter)
  const exec = await executePlan(plan, ctx, opts)

  await git.add()
  const c = await git.commit('ClaudeTR: gather')
  if (!c.committed) return { exec, conflicts: [], pushed: false, committed: false }

  const pull = await git.pull()
  if (!pull.ok) return { exec, conflicts: pull.conflicted, pushed: false, committed: true }

  let push = await git.push()
  if (!push.ok && push.rejected) {
    const p2 = await git.pull()
    if (!p2.ok) return { exec, conflicts: p2.conflicted, pushed: false, committed: true }
    push = await git.push()
  }
  return { exec, conflicts: [], pushed: push.ok, committed: true }
}

export interface ScatterResult {
  exec: ExecResult
}

/** Ejecuta scatter (working copy → máquina). No modifica el repo. */
export async function syncScatter(
  adapter: PlatformAdapter,
  plan: Plan,
  opts: { force?: boolean } = {},
): Promise<ScatterResult> {
  const ctx = await buildContext(adapter)
  const exec = await executePlan(plan, ctx, opts)
  return { exec }
}
