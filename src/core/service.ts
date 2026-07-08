import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { loadActivityLog, recordIncoming, seedActivityHead } from './activityLog'
import { loadConfig, saveConfig } from './config'
import { AppError } from './errors'
import { Git } from './git'
import { classifyCommit } from './history'
import {
  ensureSettingsLocal,
  loadLocalState,
  loadSettingsLocal,
  saveLocalState,
} from './localState'
import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import { machineSyncedPaths, pathsCollide } from './resolve'
import {
  emptyConfig,
  type Config,
  type FileChange,
  type HistoryEntry,
  type Machine,
  type Plan,
  type PlanActionType,
  type RepoStatus,
  type Verb,
} from './types'

// ── local locations (working copy = clone of the repo under configHome) ─────
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

/** Ensures a local commit identity if the user has no global one. */
async function ensureIdentity(git: Git): Promise<void> {
  const email = await git.raw(['config', 'user.email'])
  if (email.code !== 0 || !email.stdout.trim()) {
    await git.config('user.email', 'claude-total-recall@localhost')
    await git.config('user.name', 'Claude Total Recall')
  }
}

// ── onboarding: connect to the repo (clone; init structure if empty) ────────
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
    'memories/pinned',
  ]
  for (const d of dirs) {
    await mkdir(join(dir, d), { recursive: true })
    await writeFile(join(dir, d, '.gitkeep'), '')
  }
  // Defense in depth, even though the Plan guard already excludes secrets.
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
    await git.commit('Claude Total Recall: initial structure')
    await git.push(['-u', 'origin', 'HEAD'])
    return { initialized: true }
  }
  return { initialized: false }
}

// ── machine registration (fetch+reset+reapply: no JSON merge conflicts) ─────
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
  if (!machineId) throw new AppError('machine.invalidName', 'Invalid machine name.')
  const machine: Machine = { os: adapter.os(), hostname: hostname(), home: adapter.home() }

  let alreadyRegistered = false
  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await git.fetch()
    const branch = await git.currentBranch()
    // Always reapply on top of the latest remote state ⇒ the machine map never
    // conflicts textually even if another machine registers in parallel.
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
    await git.commit(`Claude Total Recall: register machine ${machineId}`)
    const push = await git.push()
    if (push.ok) break
    if (!push.rejected) {
      throw new AppError('push.rejectedRegister', `Push failed while registering: ${push.stderr}`, {
        stderr: push.stderr,
      })
    }
    if (attempt === maxAttempts - 1) {
      throw new AppError(
        'push.retriesExhaustedRegister',
        'Could not register after several retries (push rejected).',
      )
    }
  }

  await saveLocalState(adapter, { machineId })
  await ensureSettingsLocal(adapter)
  // Anchor the activity ledger's HEAD so the first incoming can attribute its source.
  await seedActivityHead(adapter, await git.revParse('HEAD'))
  return { machineId, machine, alreadyRegistered }
}

// ── add project / slot (edits config in the repo, with retry) ───────────────
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
    if (!push.rejected) {
      throw new AppError('push.failed', `Push failed: ${push.stderr}`, { stderr: push.stderr })
    }
    if (attempt === maxAttempts - 1) {
      throw new AppError('push.retriesExhausted', 'Could not save after several retries.')
    }
  }
}

export async function currentMachineId(adapter: PlatformAdapter): Promise<string | null> {
  const local = await loadLocalState(adapter)
  return local?.machineId ?? null
}

// Project and slot names are path segments in the repo
// (memories/projects/<name>/<slot>): validate the charset and prevent traversal.
// The gendered kind is gone: each kind maps to its own error code + full message
// (project.invalidName / slot.invalidName) so the renderer can localize cleanly.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/
function assertSafeName(kind: 'project' | 'slot' | 'pin', value: string): string {
  const v = value.trim()
  if (!SAFE_NAME.test(v) || /^\.+$/.test(v)) {
    throw new AppError(
      `${kind}.invalidName`,
      `Invalid ${kind} name: "${value}". Use only letters, numbers, dot, hyphen and underscore.`,
      { value },
    )
  }
  return v
}

export interface CreateProjectResult {
  alreadyExists: boolean
}

/** Creates an empty project (no folders). If it already exists, touches nothing and reports it. */
export async function createProject(
  adapter: PlatformAdapter,
  name: string,
): Promise<CreateProjectResult> {
  const proj = assertSafeName('project', name)
  let alreadyExists = false
  await commitConfigChange(adapter, `Claude Total Recall: new project ${proj}`, (config) => {
    if (config.projects[proj]) {
      alreadyExists = true
      return
    }
    config.projects[proj] = { folders: {} }
  })
  return { alreadyExists }
}

/**
 * Upserts the literal path of a slot for THIS machine (creates the project/slot
 * if missing). Expands `~` and trims. `kind` marks the slot as a single pinpoint
 * file vs a mirrored directory (default 'dir'); it is a per-slot property, so it
 * is persisted once and shared across machines.
 */
export async function setProjectFolder(
  adapter: PlatformAdapter,
  projectName: string,
  slot: string,
  absolutePath: string,
  machineId?: string,
  kind: 'file' | 'dir' = 'dir',
): Promise<void> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) {
    throw new AppError(
      'machine.notRegisteredAddProject',
      'Machine not registered; register before adding projects.',
    )
  }
  const proj = assertSafeName('project', projectName)
  const sl = assertSafeName('slot', slot)
  const path = adapter.expandHome(absolutePath.trim())
  if (!path) throw new AppError('path.empty', 'The path cannot be empty.')
  await commitConfigChange(adapter, `Claude Total Recall: set ${proj}/${sl} on ${id}`, (config) => {
    // Recursion guard (#20): reject a folder that overlaps another path already
    // synced on THIS machine — outgoing/incoming and the watcher work recursively, so
    // a nested folder would sync the same files twice. Runs against the freshly
    // pulled config; the (proj, sl) being edited is excluded so re-assigning a slot
    // doesn't collide with its own old value.
    for (const other of machineSyncedPaths(config, adapter, id, { project: proj, slot: sl })) {
      if (pathsCollide(path, other.path)) {
        throw new AppError(
          'project.folderNested',
          `This folder overlaps "${other.path}" (${other.where}), already synced on this machine. Nesting would sync the same files twice.`,
          { conflict: other.path, where: other.where },
        )
      }
    }
    const project = config.projects[proj] ?? { folders: {} }
    const folder = project.folders[sl] ?? {}
    folder[id] = path
    project.folders[sl] = folder
    project.slotKinds = { ...(project.slotKinds ?? {}), [sl]: kind }
    config.projects[proj] = project
  })
}

/** Removes THIS machine's path; if the slot ends up with no machines, deletes it. */
export async function removeProjectFolder(
  adapter: PlatformAdapter,
  projectName: string,
  slot: string,
  machineId?: string,
): Promise<void> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) throw new AppError('machine.notRegistered', 'Machine not registered.')
  await commitConfigChange(
    adapter,
    `Claude Total Recall: remove ${projectName}/${slot} on ${id}`,
    (config) => {
      const project = config.projects[projectName]
      const folder = project?.folders[slot]
      if (!folder) return
      delete folder[id]
      if (Object.keys(folder).length === 0) {
        delete project.folders[slot]
        if (project.slotKinds) delete project.slotKinds[slot]
      }
    },
  )
}

/** Deletes an entire project (all machines). */
export async function deleteProject(adapter: PlatformAdapter, projectName: string): Promise<void> {
  await commitConfigChange(
    adapter,
    `Claude Total Recall: delete project ${projectName}`,
    (config) => {
      delete config.projects[projectName]
    },
  )
}

/**
 * Renames a project: moves its config entry AND its repo folder
 * (memories/projects/<old> → <new>) in the same commit, so already-gathered
 * files aren't orphaned under the old name. Rejects on invalid/colliding/missing
 * names (the throw aborts the commit — nothing is persisted).
 */
export async function renameProject(
  adapter: PlatformAdapter,
  oldName: string,
  newName: string,
): Promise<void> {
  const to = assertSafeName('project', newName)
  await commitConfigChange(
    adapter,
    `Claude Total Recall: rename project ${oldName} -> ${to}`,
    async (config) => {
      if (!config.projects[oldName])
        throw new AppError('project.notFound', `Project "${oldName}" not found.`, { name: oldName })
      if (oldName === to) return
      if (config.projects[to])
        throw new AppError('project.exists', `A project named "${to}" already exists.`, {
          name: to,
        })
      config.projects[to] = config.projects[oldName]
      delete config.projects[oldName]
      // Move the gathered folder so its files follow the new name (no orphans).
      const base = join(workingCopyDir(adapter), 'memories', 'projects')
      const src = join(base, oldName)
      const exists = await stat(src)
        .then(() => true)
        .catch(() => false)
      if (exists) await rename(src, join(base, to))
    },
  )
}

// ── pinned files (global pinpoint files, outside any project) ────────────────
/**
 * Upserts a global pinned FILE path for THIS machine (creates the pin if
 * missing). Same nesting guard as project folders. Kind is always 'file'.
 */
export async function setPinnedFile(
  adapter: PlatformAdapter,
  pinId: string,
  absolutePath: string,
  machineId?: string,
): Promise<void> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) throw new AppError('machine.notRegistered', 'Machine not registered.')
  const pin = assertSafeName('pin', pinId)
  const path = adapter.expandHome(absolutePath.trim())
  if (!path) throw new AppError('path.empty', 'The path cannot be empty.')
  await commitConfigChange(adapter, `Claude Total Recall: pin ${pin} on ${id}`, (config) => {
    for (const other of machineSyncedPaths(config, adapter, id, { pin })) {
      if (pathsCollide(path, other.path)) {
        throw new AppError(
          'pin.folderNested',
          `This file overlaps "${other.path}" (${other.where}), already synced on this machine.`,
          { conflict: other.path, where: other.where },
        )
      }
    }
    const pins = config.pinnedFiles ?? {}
    const byMachine = pins[pin] ?? {}
    byMachine[id] = path
    pins[pin] = byMachine
    config.pinnedFiles = pins
  })
}

/** Removes an entire pinned file (all machines). */
export async function removePinnedFile(adapter: PlatformAdapter, pinId: string): Promise<void> {
  await commitConfigChange(adapter, `Claude Total Recall: unpin ${pinId}`, (config) => {
    if (config.pinnedFiles) delete config.pinnedFiles[pinId]
  })
}

// ── conflicts ───────────────────────────────────────────────────────────────
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

/** Completes the merge and pushes if it can. */
export async function completeConflictMerge(
  adapter: PlatformAdapter,
): Promise<{ pushed: boolean }> {
  const git = new Git(workingCopyDir(adapter))
  await git.completeMerge('Claude Total Recall: resolve conflicts')
  const push = await git.push()
  return { pushed: push.ok }
}

// ── status ──────────────────────────────────────────────────────────────────
export function repoStatus(adapter: PlatformAdapter): Promise<RepoStatus> {
  return new Git(workingCopyDir(adapter)).status()
}

/**
 * Activity history (#8): the repo's git log classified into typed entries, MERGED
 * with the local incoming ledger (incoming never commits, so it isn't in git).
 * Merges, the initial-structure seed and external commits are filtered out; the
 * combined list is sorted newest-first and capped to `limit`.
 */
export async function history(adapter: PlatformAdapter, limit = 50): Promise<HistoryEntry[]> {
  const raw = await new Git(workingCopyDir(adapter)).log(limit)
  const out: HistoryEntry[] = []
  for (const r of raw) {
    const c = classifyCommit(r.subject)
    if (!c) continue
    out.push({ hash: r.hash, at: r.at, files: r.files, changes: r.changes, ...c })
  }
  const log = await loadActivityLog(adapter)
  for (const r of log.incoming) {
    out.push({
      hash: `incoming:${r.id}`, // synthetic key; git hashes are 40-hex, never collide
      at: r.at,
      type: 'incoming',
      fromMachines: r.fromMachines,
      files: r.changes.length,
      changes: r.changes,
    })
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit)
}

export async function pullRepo(
  adapter: PlatformAdapter,
): Promise<{ ok: boolean; conflicts: string[] }> {
  const r = await new Git(workingCopyDir(adapter)).pull()
  return { ok: r.ok, conflicts: r.conflicted }
}

// ── sync context (config + identity + local overrides) ──────────────────────
async function buildContext(adapter: PlatformAdapter): Promise<SyncContext> {
  const config = await loadRepoConfig(adapter)
  const local = await loadLocalState(adapter)
  if (!local) {
    throw new AppError(
      'machine.notRegisteredLocal',
      'Machine not registered (local.json missing). Run `claude-total-recall register`.',
    )
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

// ── git-backed execution ────────────────────────────────────────────────────
export interface OutgoingResult {
  exec: ExecResult
  conflicts: string[]
  pushed: boolean
  committed: boolean
}

/** Runs the outgoing sync (machine → working copy) and syncs with the remote. */
export async function syncOutgoing(
  adapter: PlatformAdapter,
  plan: Plan,
  opts: { force?: boolean } = {},
): Promise<OutgoingResult> {
  const git = new Git(workingCopyDir(adapter))
  const ctx = await buildContext(adapter)
  const exec = await executePlan(plan, ctx, opts)

  await git.add()
  // Stamp the machine so the activity history (#8) can attribute and direct (↑/↓) it.
  const c = await git.commit(`Claude Total Recall: outgoing on ${ctx.machineId}`)
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

export interface IncomingResult {
  exec: ExecResult
}

/** Plan action type → friendly file-change status (incoming perspective); null = nothing changed. */
function actionStatus(type: PlanActionType): FileChange['status'] | null {
  switch (type) {
    case 'create':
      return 'added'
    case 'overwrite':
      return 'modified'
    case 'delete':
      return 'deleted'
    default:
      return null // noop / skip
  }
}

/** Distinct outgoing-commit authors pulled in `(lastHead, head]`, excluding this machine. */
async function incomingSources(
  git: Git,
  lastHead: string | undefined,
  head: string | null,
  self: string,
): Promise<string[]> {
  if (!lastHead || !head || lastHead === head) return []
  const seen = new Set<string>()
  for (const r of await git.logRange(lastHead, head)) {
    const c = classifyCommit(r.subject)
    if (c?.type === 'outgoing' && c.machineId && c.machineId !== self) seen.add(c.machineId)
  }
  return [...seen]
}

/**
 * Records an incoming sync in the local ledger. Per-file changes come from the
 * executed Plan's actions (a successful executePlan means every create/overwrite/
 * delete applied); the source machine(s) from the commits pulled since the last
 * recorded HEAD. Only reads git + writes a local file — never touches the remote.
 * Reuses the Plan's injected `id`/`createdAt` (no internal Date.now/randomUUID).
 */
async function recordIncomingFromPlan(
  adapter: PlatformAdapter,
  ctx: SyncContext,
  plan: Plan,
  exec: ExecResult,
): Promise<void> {
  if (exec.applied === 0) return // nothing landed → nothing to record
  const changes: FileChange[] = []
  for (const a of plan.actions) {
    const status = actionStatus(a.type)
    if (status) changes.push({ status, path: a.logicalPath })
  }
  if (changes.length === 0) return

  const git = new Git(workingCopyDir(adapter))
  const head = await git.revParse('HEAD')
  const { lastHead } = await loadActivityLog(adapter)
  const fromMachines = await incomingSources(git, lastHead, head, ctx.machineId)
  await recordIncoming(adapter, { id: plan.id, at: plan.createdAt, fromMachines, changes }, head)
}

/** Runs the incoming sync (working copy → machine). Does not modify the repo. */
export async function syncIncoming(
  adapter: PlatformAdapter,
  plan: Plan,
  opts: { force?: boolean } = {},
): Promise<IncomingResult> {
  const ctx = await buildContext(adapter)
  const exec = await executePlan(plan, ctx, opts)
  try {
    await recordIncomingFromPlan(adapter, ctx, plan, exec)
  } catch {
    // Best-effort ledger: the machine's files are already applied, so never let a
    // logging hiccup surface as a sync failure.
  }
  return { exec }
}
