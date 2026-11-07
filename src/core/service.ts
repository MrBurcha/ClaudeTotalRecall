import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { loadActivityLog, recordIncoming, seedActivityHead } from './activityLog'
import { loadConfig, saveConfig } from './config'
import { resolveConflictFile } from './conflict'
import { AppError } from './errors'
import { readMemoryFilePreview } from './filePreview'
import { Git, type PullResult } from './git'
import { GhAccountAuth, type AccountStore } from './gitAuth'
import { classifyCommit } from './history'
import {
  ensureSettingsLocal,
  loadGithubAccount,
  loadLocalState,
  loadSettingsLocal,
  saveGithubAccount,
  saveLocalState,
} from './localState'
import {
  correctProjectFolderPick,
  discoverProjectSources,
  proposeMachineMapping,
  scanClaudeProjects,
  slug,
  type DiscoveryProposal,
  type FolderPickCorrection,
  type MachineMappingProposal,
  type ScannedProject,
} from './discovery'
import { isManagedRepoPath, managedGitignoreLines, managedRepoPaths } from './managedPaths'
import {
  buildPlan,
  executePlan,
  machineSharedSettings,
  type ExecResult,
  type SyncContext,
} from './plan'
import { COMMIT_PREFIX } from './history'
import { withRepoLock } from './repoLock'
import { machinePathForLogical, machineSyncedPaths, pathsCollide } from './resolve'
import {
  emptyConfig,
  type Config,
  type FileChange,
  type FilePreview,
  type HistoryEntry,
  type Machine,
  type Plan,
  type PlanAction,
  type PlanActionType,
  type RepoStatus,
  type Verb,
} from './types'

// ── local locations (working copy = clone of the repo under configHome) ─────
// gh logins found this session, per config home — covers the window before
// registration, when there's no local.json to persist them in yet.
const sessionAccounts = new Map<string, string>()

function accountStore(adapter: PlatformAdapter): AccountStore {
  const key = adapter.configHome()
  return {
    load: async () => (await loadGithubAccount(adapter)) ?? sessionAccounts.get(key),
    save: async (login) => {
      sessionAccounts.set(key, login)
      await saveGithubAccount(adapter, login)
    },
  }
}

/**
 * The working copy's git, authenticating to GitHub with whichever gh account can
 * reach the repo — not just the active one (see core/gitAuth.ts). Every flow that
 * talks to the remote must use this rather than `new Git(dir)`.
 */
export function repoGit(adapter: PlatformAdapter): Git {
  return new Git(workingCopyDir(adapter), 'git', new GhAccountAuth(accountStore(adapter)))
}

export function workingCopyDir(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'repo')
}
/** The shared config file, in the memories repo. */
export const CONFIG_FILE = 'engram.json'
/** Its name before the Engram rename (#123); still read and written until migrated. */
export const LEGACY_CONFIG_FILE = 'claudetr.json'

/** Where a NEW repo keeps its shared config (initStructure); see resolveConfigPath. */
export function configPath(adapter: PlatformAdapter): string {
  return join(workingCopyDir(adapter), CONFIG_FILE)
}

/**
 * The shared config file this repo actually uses, for reads AND writes:
 * engram.json if present, else claudetr.json if present, else engram.json.
 * A mixed fleet keeps using claudetr.json consistently (older versions only read
 * that) until someone runs the explicit migration once the whole fleet is on Engram
 * (migrateSharedConfig). Never renamed automatically: that would break every
 * machine still on an older version at once. Resolve it AFTER any reset, so a
 * migration pushed by another machine is adopted on the next attempt.
 */
export async function resolveConfigPath(adapter: PlatformAdapter): Promise<string> {
  const next = configPath(adapter)
  if (await pathExists(next)) return next
  const legacy = join(workingCopyDir(adapter), LEGACY_CONFIG_FILE)
  if (await pathExists(legacy)) return legacy
  return next
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function loadRepoConfig(adapter: PlatformAdapter): Promise<Config> {
  return loadConfig(await resolveConfigPath(adapter))
}

/** Ensures a local commit identity if the user has no global one. */
async function ensureIdentity(git: Git): Promise<void> {
  const email = await git.raw(['config', 'user.email'])
  if (email.code !== 0 || !email.stdout.trim()) {
    await git.config('user.email', 'engram@localhost')
    await git.config('user.name', 'Engram')
  }
}

// ── onboarding: connect to the repo (clone; init structure if empty) ────────
export interface ConnectResult {
  initialized: boolean
}

async function initStructure(dir: string, remote: string): Promise<void> {
  await saveConfig(join(dir, CONFIG_FILE), emptyConfig(remote))
  const dirs = [
    'memories/user/commands',
    'memories/user/agents',
    'memories/user/skills',
    'memories/projects',
    'memories/pinned',
    // Notebook (#104): cloud-native notes space. Additive/back-compatible — an
    // older app version simply ignores the extra tree.
    'memories/notebook/general',
    'memories/notebook/projects',
  ]
  for (const d of dirs) {
    await mkdir(join(dir, d), { recursive: true })
    await writeFile(join(dir, d, '.gitkeep'), '')
  }
  // Defense in depth, even though the Plan guard already excludes secrets.
  await writeFile(join(dir, '.gitignore'), '.DS_Store\n.credentials.json\n*.jsonl\n.claude.json\n')
  await ensureGitIgnore(dir)
  await ensureGitAttributes(dir)
}

/**
 * Appends any missing Claude-managed path (`managedGitignoreLines`) to the repo's
 * `.gitignore`, creating it if needed. Idempotent; true when the file changed.
 * The entry is what keeps an OLDER app version from re-adding the purged cache:
 * its `git add -A` skips untracked, ignored files (#135).
 */
async function ensureGitIgnore(dir: string): Promise<boolean> {
  const file = join(dir, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()))
  const missing = managedGitignoreLines().filter((l) => !present.has(l))
  if (missing.length === 0) return false
  const head = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`
  await writeFile(file, `${head}${missing.join('\n')}\n`)
  return true
}

/**
 * `* -text`: git stores every file's bytes verbatim and never converts line
 * endings. Without it, a Windows machine (or core.autocrlf=true) rewrites LF↔CRLF
 * on checkout, so a byte-identical file hashes differently across machines —
 * phantom "overwrite" churn and false PlanDriftError. Idempotent: only writes when
 * the attribute is missing, so an already-initialized working copy is backfilled.
 */
async function ensureGitAttributes(dir: string): Promise<void> {
  const file = join(dir, '.gitattributes')
  try {
    const existing = await readFile(file, 'utf8')
    if (/^\s*\*\s+-text\s*$/m.test(existing)) return
    await writeFile(
      file,
      existing.endsWith('\n') ? `${existing}* -text\n` : `${existing}\n* -text\n`,
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await writeFile(file, '* -text\n')
  }
}

export async function connectRepo(
  remote: string,
  adapter: PlatformAdapter,
): Promise<ConnectResult> {
  const dir = workingCopyDir(adapter)
  await mkdir(adapter.configHome(), { recursive: true })

  let git: Git
  if (await pathExists(join(dir, '.git'))) {
    git = repoGit(adapter)
    await git.fetch()
  } else {
    git = await Git.clone(remote, dir, 'git', new GhAccountAuth(accountStore(adapter)))
  }
  await ensureIdentity(git)

  if (!(await pathExists(await resolveConfigPath(adapter)))) {
    await initStructure(dir, remote)
    await git.add()
    await git.commit(`${COMMIT_PREFIX}initial structure`)
    await git.push(['-u', 'origin', 'HEAD'])
    return { initialized: true }
  }
  // Backfill .gitattributes on repos initialized before it existed, so Windows
  // machines joining an older working copy still get byte-verbatim EOL handling.
  // pushPendingCommits pulls-then-pushes safely if origin has advanced; if it
  // can't (offline/conflict) the local commit rides the next sync.
  if (!(await pathExists(join(dir, '.gitattributes')))) {
    await ensureGitAttributes(dir)
    await git.add()
    await git.commit(`${COMMIT_PREFIX}add .gitattributes (verbatim EOL)`)
    try {
      await pushPendingCommits(git)
    } catch {
      // best-effort: the committed .gitattributes propagates on the next sync
    }
  }
  return { initialized: false }
}

// ── machine registration (fetch+reset+reapply: no JSON merge conflicts) ─────
export interface RegisterResult {
  machineId: string
  machine: Machine
  alreadyRegistered: boolean
  /** per-machine paths brought back from before this machine was removed (rejoin) */
  restored: number
}

type MachinePaths = Record<string, Record<string, string>>
interface ConfigSnapshot {
  projects?: Record<string, { folders?: MachinePaths; slotKinds?: Record<string, 'file' | 'dir'> }>
  pinnedFiles?: MachinePaths
}

/**
 * The newest shared-config version in git history where `id` was still registered
 * (before someone removed it), or null. Read leniently: an old snapshot only lends
 * paths, it's never written back as a whole.
 */
async function lastSnapshotWith(git: Git, id: string): Promise<ConfigSnapshot | null> {
  const log = await git.raw([
    'log',
    '--format=%H',
    '-n',
    '300',
    '--',
    CONFIG_FILE,
    LEGACY_CONFIG_FILE,
  ])
  if (log.code !== 0) return null
  for (const hash of log.stdout.split(/\r?\n/).filter(Boolean)) {
    for (const file of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
      const show = await git.raw(['show', `${hash}:${file}`])
      if (show.code !== 0) continue
      try {
        const snap = JSON.parse(show.stdout) as ConfigSnapshot & {
          machines?: Record<string, unknown>
        }
        if (snap.machines && snap.machines[id]) return snap
      } catch {
        /* unreadable version: look further back */
      }
      break
    }
  }
  return null
}

/**
 * Rejoin (#123 follow-up): a machine registering under a name it had before gets back
 * the project folders and pinned files it had then — only paths that still exist on
 * this disk, and only for projects that still exist. Makes "remove machine" undoable.
 */
async function restoreMachinePaths(
  adapter: PlatformAdapter,
  git: Git,
  config: Config,
  id: string,
): Promise<number> {
  const snap = await lastSnapshotWith(git, id)
  if (!snap) return 0
  let restored = 0
  for (const [name, past] of Object.entries(snap.projects ?? {})) {
    const project = config.projects[name]
    if (!project) continue // deleted since: don't resurrect it
    for (const [slot, paths] of Object.entries(past.folders ?? {})) {
      const path = paths?.[id]
      if (typeof path !== 'string' || project.folders[slot]?.[id]) continue
      if (!(await pathExists(adapter.normalize(path)))) continue
      project.folders[slot] = { ...(project.folders[slot] ?? {}), [id]: path }
      const kind = past.slotKinds?.[slot]
      if (kind && !project.slotKinds?.[slot]) {
        project.slotKinds = { ...(project.slotKinds ?? {}), [slot]: kind }
      }
      restored++
    }
  }
  for (const [pin, paths] of Object.entries(snap.pinnedFiles ?? {})) {
    const path = paths?.[id]
    if (typeof path !== 'string' || config.pinnedFiles?.[pin]?.[id]) continue
    if (!(await pathExists(adapter.normalize(path)))) continue
    config.pinnedFiles = { ...(config.pinnedFiles ?? {}) }
    config.pinnedFiles[pin] = { ...(config.pinnedFiles[pin] ?? {}), [id]: path }
    restored++
  }
  return restored
}

export function registerMachine(adapter: PlatformAdapter, name?: string): Promise<RegisterResult> {
  // Serialize against Notebook saves and config edits so the reset loop below can't
  // race with (and discard) an unpushed local commit (#104).
  return withRepoLock(() => registerMachineLocked(adapter, name))
}

async function registerMachineLocked(
  adapter: PlatformAdapter,
  name?: string,
): Promise<RegisterResult> {
  const git = repoGit(adapter)
  await ensureIdentity(git)
  const machineId = slug(name ?? hostname())
  if (!machineId) throw new AppError('machine.invalidName', 'Invalid machine name.')
  const machine: Machine = { os: adapter.os(), hostname: hostname(), home: adapter.home() }

  // Protect unpushed Notebook commits from the hard reset in the retry loop (#104).
  await pushPendingCommits(git)

  let alreadyRegistered = false
  let restored = 0
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
    restored = existing ? 0 : await restoreMachinePaths(adapter, git, config, machineId)
    config.machines[machineId] = machine
    await saveConfig(await resolveConfigPath(adapter), config)
    await git.add()
    await git.commit(`${COMMIT_PREFIX}register machine ${machineId}`)
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
  return { machineId, machine, alreadyRegistered, restored }
}

/**
 * Pushes local commits that are ahead of origin before a caller runs
 * `resetHard(origin)`. The mirror flows discard local state to stay conflict-free,
 * but the Notebook (#104) introduces genuinely local commits (a save is a local
 * commit, pushed later) that a hard reset would destroy. This lands them safely
 * first: fetch, integrate the remote when behind, then push — surfacing a merge
 * conflict instead of losing data. A no-op when nothing is ahead (the common case
 * for every pre-Notebook flow), so existing behavior is unchanged.
 */
async function pushPendingCommits(git: Git): Promise<void> {
  await git.fetch()
  let st = await git.status()
  if (st.ahead === 0) return
  const conflict = (files: string[]): AppError =>
    new AppError('sync.pendingConflict', 'Resolve the pending sync conflicts before continuing.', {
      files: files.join(', '),
    })
  if (st.behind > 0) {
    const pull = await pullMerge(git)
    if (!pull.ok) throw conflict(pull.conflicted)
    st = await git.status()
  }
  if (st.ahead > 0) {
    let push = await git.push()
    if (!push.ok && push.rejected) {
      const p2 = await pullMerge(git)
      if (!p2.ok) throw conflict(p2.conflicted)
      push = await git.push()
    }
    if (!push.ok) {
      throw new AppError('push.failed', `Push failed: ${push.stderr}`, { stderr: push.stderr })
    }
  }
}

// ── add project / slot (edits config in the repo, with retry) ───────────────
function commitConfigChange(
  adapter: PlatformAdapter,
  message: string,
  mutate: (config: Config) => void | Promise<void>,
): Promise<void> {
  // Serialize against Notebook saves so a save can't land between this flow's
  // fetch and reset --hard and be silently discarded (#104).
  return withRepoLock(() => commitConfigChangeLocked(adapter, message, mutate))
}

async function commitConfigChangeLocked(
  adapter: PlatformAdapter,
  message: string,
  mutate: (config: Config) => void | Promise<void>,
): Promise<void> {
  const git = repoGit(adapter)
  await ensureIdentity(git)
  // Protect unpushed Notebook commits from the hard reset below (#104).
  await pushPendingCommits(git)
  const maxAttempts = 6
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await git.fetch()
    await git.resetHard(`origin/${await git.currentBranch()}`)
    const config = await loadRepoConfig(adapter)
    await mutate(config)
    await saveConfig(await resolveConfigPath(adapter), config)
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

// ── shared config rename (#123): claudetr.json → engram.json, AUTOMATIC ─────
//
// Releases before Engram only read claudetr.json, so renaming it while any machine
// still runs one would stop that machine from syncing. Instead of asking the user to
// pick the moment, every machine running Engram leaves a marker in the repo
// (`.engram/machines/<id>.json`, a path older versions never look at). After each
// successful sync the engine runs one step: mark this machine; once EVERY machine in
// the config is marked, rename the file and drop the markers. A machine that's gone
// for good would block it forever, so it can be removed from the repo (removeMachine)
// — or, as a last resort, the rename can be forced (migrateSharedConfig).

/** Where each machine running Engram marks itself until the rename happens. */
export const FLEET_MARKERS_DIR = '.engram/machines'
const FLEET_ROOT = '.engram'

export interface SharedConfigInfo {
  /** the file this repo uses today */
  file: typeof CONFIG_FILE | typeof LEGACY_CONFIG_FILE
  /** every machine registered in the repo */
  machines: string[]
  /** machines already running Engram (marked) — only meaningful before the rename */
  ready: string[]
  /** machines the automatic rename is waiting for */
  waiting: string[]
}

async function fleetMarkers(dir: string): Promise<Set<string>> {
  try {
    const names = await readdir(join(dir, FLEET_MARKERS_DIR))
    return new Set(names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)))
  } catch {
    return new Set()
  }
}

/** Which shared config file the working copy uses and, before the rename, who it waits for. */
export async function sharedConfigInfo(adapter: PlatformAdapter): Promise<SharedConfigInfo> {
  const path = await resolveConfigPath(adapter)
  const config = await loadConfig(path)
  const file = path.endsWith(LEGACY_CONFIG_FILE) ? LEGACY_CONFIG_FILE : CONFIG_FILE
  const machines = Object.keys(config.machines).sort()
  if (file === CONFIG_FILE) return { file, machines, ready: machines, waiting: [] }
  const marked = await fleetMarkers(workingCopyDir(adapter))
  return {
    file,
    machines,
    ready: machines.filter((m) => marked.has(m)),
    waiting: machines.filter((m) => !marked.has(m)),
  }
}

export type RenameStep = 'skipped' | 'waiting' | 'marked' | 'renamed' | 'done'

/**
 * One step of the automatic rename. The engine calls it after every successful sync,
 * already holding the repo lock (it doesn't take it: the lock isn't reentrant). It
 * commits locally and tries one push; a rejected push simply rides the next cycle.
 * Never touches memory files.
 */
export async function advanceSharedConfigRename(adapter: PlatformAdapter): Promise<RenameStep> {
  const machineId = await currentMachineId(adapter)
  if (!machineId) return 'skipped'
  const dir = workingCopyDir(adapter)
  const git = repoGit(adapter)

  if (await pathExists(join(dir, CONFIG_FILE))) {
    // Already renamed. A marker can survive a concurrent rename (two machines on the
    // same cycle): sweep it so the repo ends up clean.
    if (!(await pathExists(join(dir, FLEET_ROOT)))) return 'done'
    await ensureIdentity(git)
    await git.out(['rm', '-r', '-q', '--ignore-unmatch', FLEET_ROOT])
    await rm(join(dir, FLEET_ROOT), { recursive: true, force: true })
    await git.commit(`${COMMIT_PREFIX}fleet: clean up rename markers`)
    await git.push()
    return 'done'
  }
  if (!(await pathExists(join(dir, LEGACY_CONFIG_FILE)))) return 'skipped'

  await ensureIdentity(git)
  const marker = join(dir, FLEET_MARKERS_DIR, `${machineId}.json`)
  let marked = false
  if (!(await pathExists(marker))) {
    await mkdir(join(dir, FLEET_MARKERS_DIR), { recursive: true })
    await writeFile(marker, `${JSON.stringify({ machine: machineId, app: 'engram' }, null, 2)}\n`)
    await git.out(['add', '--', `${FLEET_MARKERS_DIR}/${machineId}.json`])
    marked = true
  }

  const { waiting } = await sharedConfigInfo(adapter)
  if (waiting.length === 0) {
    await git.out(['mv', LEGACY_CONFIG_FILE, CONFIG_FILE])
    await git.out(['rm', '-r', '-q', '-f', '--ignore-unmatch', FLEET_ROOT])
    await rm(join(dir, FLEET_ROOT), { recursive: true, force: true })
    await git.commit(`${COMMIT_PREFIX}fleet: shared config renamed to ${CONFIG_FILE}`)
    await git.push()
    return 'renamed'
  }
  if (marked) {
    await git.commit(`${COMMIT_PREFIX}fleet: ${machineId} runs Engram`)
    await git.push()
    return 'marked'
  }
  return 'waiting'
}

/**
 * Forces the rename now (git mv + commit + push, with the config-edit retry
 * mechanics). Normally unnecessary: the engine does it on its own once every machine
 * runs Engram. Machines still on an older version stop syncing until updated.
 */
export function migrateSharedConfig(adapter: PlatformAdapter): Promise<{ migrated: boolean }> {
  return withRepoLock(async () => {
    const git = repoGit(adapter)
    await ensureIdentity(git)
    await pushPendingCommits(git)
    const dir = workingCopyDir(adapter)
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await git.fetch()
      await git.resetHard(`origin/${await git.currentBranch()}`)
      if (await pathExists(join(dir, CONFIG_FILE))) return { migrated: false }
      if (!(await pathExists(join(dir, LEGACY_CONFIG_FILE)))) {
        throw new AppError('config.missing', 'This repo has no shared config file to migrate.')
      }
      await git.out(['mv', LEGACY_CONFIG_FILE, CONFIG_FILE])
      await git.out(['rm', '-r', '-q', '-f', '--ignore-unmatch', FLEET_ROOT])
      await rm(join(dir, FLEET_ROOT), { recursive: true, force: true })
      await git.commit(`${COMMIT_PREFIX}fleet: shared config renamed to ${CONFIG_FILE}`)
      const push = await git.push()
      if (push.ok) return { migrated: true }
      if (!push.rejected) {
        throw new AppError('push.failed', `Push failed: ${push.stderr}`, { stderr: push.stderr })
      }
    }
    throw new AppError('push.retriesExhausted', 'Could not save after several retries.')
  })
}

/**
 * Removes a machine that's gone for good from the repo: its entry and its per-machine
 * paths (a project source or pinned file left with no machine at all is dropped too).
 * The memory it already synced stays in the repo. Not allowed for this machine.
 */
export async function removeMachine(adapter: PlatformAdapter, id: string): Promise<void> {
  if (id === (await currentMachineId(adapter))) {
    throw new AppError('machine.removeSelf', "This machine can't remove itself.")
  }
  await commitConfigChange(adapter, `${COMMIT_PREFIX}remove machine ${id}`, (config) => {
    if (!config.machines[id]) {
      throw new AppError('machine.unknown', `Machine "${id}" isn't registered.`, { value: id })
    }
    delete config.machines[id]
    for (const project of Object.values(config.projects)) {
      for (const [slot, paths] of Object.entries(project.folders)) {
        delete paths[id]
        if (Object.keys(paths).length === 0) {
          delete project.folders[slot]
          if (project.slotKinds) delete project.slotKinds[slot]
        }
      }
    }
    for (const [pin, paths] of Object.entries(config.pinnedFiles ?? {})) {
      delete paths[id]
      if (Object.keys(paths).length === 0) delete config.pinnedFiles![pin]
    }
  })
}

export async function currentMachineId(adapter: PlatformAdapter): Promise<string | null> {
  const local = await loadLocalState(adapter)
  return local?.machineId ?? null
}

/**
 * Reads a memories file from the working copy for the preview modal (#43) and
 * resolves its real path on this machine (for the "reveal in file manager"
 * button). Content always comes from the synced working copy, never the machine
 * source, so secrets that never travel can't be surfaced.
 */
export async function filePreview(
  adapter: PlatformAdapter,
  repoRelPath: string,
): Promise<FilePreview> {
  const preview = await readMemoryFilePreview(workingCopyDir(adapter), repoRelPath)
  const sourcePath = await resolveSourcePath(adapter, repoRelPath)
  return { ...preview, sourcePath }
}

/**
 * The real path of a memories file on this machine, if it's configured here and
 * present on disk; otherwise null. Re-derived server-side so a reveal request
 * can never point at an arbitrary path supplied by the renderer.
 */
export async function resolveSourcePath(
  adapter: PlatformAdapter,
  repoRelPath: string,
): Promise<string | null> {
  const machineId = await currentMachineId(adapter)
  if (!machineId) return null
  let config: Config
  try {
    config = await loadRepoConfig(adapter)
  } catch {
    return null
  }
  const path = machinePathForLogical(repoRelPath, config, machineId, adapter)
  if (!path) return null
  return (await pathExists(path)) ? path : null
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

/**
 * The existing project key equal to `name` ignoring case, or null. The project
 * name IS the identity (the repo folder `memories/projects/<name>/`), so two keys
 * differing only in case would collide on a case-insensitive filesystem (macOS).
 * Guards the canonical-name namespace when a NEW key is introduced — never
 * renames or lowercases existing entries.
 */
function findProjectKeyCI(config: Config, name: string): string | null {
  const lower = name.toLowerCase()
  for (const key of Object.keys(config.projects)) {
    if (key.toLowerCase() === lower) return key
  }
  return null
}

/** Throws when `name` case-collides with a DIFFERENT existing project key. */
function assertNoCaseCollision(config: Config, name: string, allow?: string): void {
  const ci = findProjectKeyCI(config, name)
  if (ci && ci !== name && ci !== allow) {
    throw new AppError(
      'project.existsCaseInsensitive',
      `A project named "${ci}" already exists (names are case-insensitive).`,
      { name, existing: ci },
    )
  }
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
  await commitConfigChange(adapter, `${COMMIT_PREFIX}new project ${proj}`, (config) => {
    if (config.projects[proj]) {
      alreadyExists = true
      return
    }
    assertNoCaseCollision(config, proj)
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
  await commitConfigChange(adapter, `${COMMIT_PREFIX}set ${proj}/${sl} on ${id}`, (config) => {
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
    `${COMMIT_PREFIX}remove ${projectName}/${slot} on ${id}`,
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
  await commitConfigChange(adapter, `${COMMIT_PREFIX}delete project ${projectName}`, (config) => {
    delete config.projects[projectName]
  })
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
    `${COMMIT_PREFIX}rename project ${oldName} -> ${to}`,
    async (config) => {
      if (!config.projects[oldName])
        throw new AppError('project.notFound', `Project "${oldName}" not found.`, { name: oldName })
      if (oldName === to) return
      if (config.projects[to])
        throw new AppError('project.exists', `A project named "${to}" already exists.`, {
          name: to,
        })
      // Case-only collision with a DIFFERENT project (allow fixing this one's own casing).
      assertNoCaseCollision(config, to, oldName)
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

// ── discovery & cross-machine adoption (batch writes, one commit) ───────────
interface SlotWrite {
  slot: string
  path: string
  kind: 'file' | 'dir'
}

interface NormalizedProject {
  proj: string
  writes: Array<{ slot: string; path: string; kind: 'file' | 'dir' }>
}

/** Validates a project name + its slot writes and expands/trims each path. */
function normalizeProject(adapter: PlatformAdapter, input: ApplyDiscoveryInput): NormalizedProject {
  const proj = assertSafeName('project', input.projectName)
  const writes = input.slots.map((w) => {
    const path = adapter.expandHome(w.path.trim())
    if (!path) throw new AppError('path.empty', 'The path cannot be empty.')
    return { slot: assertSafeName('slot', w.slot), path, kind: w.kind }
  })
  return { proj, writes }
}

/**
 * Writes one project's slots for `id` into `config`, checking every path against
 * the shared `claimed` set (already-synced paths PLUS earlier writes in the same
 * batch, so siblings — even across projects — can't nest). Mutates `config` and
 * appends each accepted path to `claimed`. Assumes self-overlap was already
 * neutralized by the caller before `claimed` was snapshotted.
 */
function writeProjectSlots(
  config: Config,
  np: NormalizedProject,
  id: string,
  claimed: ReturnType<typeof machineSyncedPaths>,
): void {
  const existing = config.projects[np.proj]
  // A new key must not case-collide with an existing project (adoption keeps the
  // existing key, so this only fires when a scan/discovery would CREATE one).
  if (!existing) assertNoCaseCollision(config, np.proj)
  const project = existing ?? { folders: {} }
  for (const w of np.writes) {
    for (const other of claimed) {
      if (pathsCollide(w.path, other.path)) {
        throw new AppError(
          'project.folderNested',
          `This folder overlaps "${other.path}" (${other.where}), already synced on this machine. Nesting would sync the same files twice.`,
          { conflict: other.path, where: other.where },
        )
      }
    }
    const folder = project.folders[w.slot] ?? {}
    folder[id] = w.path
    project.folders[w.slot] = folder
    project.slotKinds = { ...(project.slotKinds ?? {}), [w.slot]: w.kind }
    claimed.push({ path: w.path, where: `${np.proj}/${w.slot}` })
  }
  config.projects[np.proj] = project
}

/** Deletes `id`'s prior paths for a batch's slots, so a re-write doesn't collide with its own old value. */
function neutralizeSelfOverlap(config: Config, np: NormalizedProject, id: string): void {
  const project = config.projects[np.proj]
  if (!project) return
  for (const w of np.writes) {
    const folder = project.folders[w.slot]
    if (folder) delete folder[id]
  }
}

/**
 * Writes N slot paths for one machine in a SINGLE commit, with a whole-batch
 * nesting guard. A throw aborts the commit ⇒ nothing persists.
 */
async function batchSetProjectFolders(
  adapter: PlatformAdapter,
  projectName: string,
  writes: SlotWrite[],
  id: string,
  message: string,
  opts: { createIfMissing: boolean },
): Promise<{ created: boolean; slots: number }> {
  const np = normalizeProject(adapter, { projectName, slots: writes })
  let created = false
  await commitConfigChange(adapter, message, (config) => {
    const existing = config.projects[np.proj]
    created = !existing
    if (!existing && !opts.createIfMissing) {
      throw new AppError('project.notFound', `Project "${projectName}" not found.`, {
        name: projectName,
      })
    }
    neutralizeSelfOverlap(config, np, id)
    writeProjectSlots(config, np, id, machineSyncedPaths(config, adapter, id))
  })
  return { created, slots: np.writes.length }
}

export interface ApplyDiscoveryInput {
  projectName: string
  slots: SlotWrite[]
}
export interface ApplyDiscoveryResult {
  created: boolean
  slots: number
}

/** Applies a reviewed discovery proposal: creates the project if needed and writes every slot for THIS machine in one commit. */
export async function applyDiscovery(
  adapter: PlatformAdapter,
  input: ApplyDiscoveryInput,
  machineId?: string,
): Promise<ApplyDiscoveryResult> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) {
    throw new AppError(
      'machine.notRegisteredAddProject',
      'Machine not registered; register before adding projects.',
    )
  }
  const proj = assertSafeName('project', input.projectName)
  return batchSetProjectFolders(
    adapter,
    proj,
    input.slots,
    id,
    `${COMMIT_PREFIX}discover ${proj} on ${id}`,
    { createIfMissing: true },
  )
}

export interface ApplyMachineMappingInput {
  projectName: string
  slots: SlotWrite[]
}

/** Applies a reviewed cross-machine mapping: writes the (existing) project's slot paths for THIS machine in one commit. */
export async function applyMachineMapping(
  adapter: PlatformAdapter,
  input: ApplyMachineMappingInput,
  machineId?: string,
): Promise<{ slots: number }> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) throw new AppError('machine.notRegistered', 'Machine not registered.')
  const proj = assertSafeName('project', input.projectName)
  const { slots } = await batchSetProjectFolders(
    adapter,
    proj,
    input.slots,
    id,
    `${COMMIT_PREFIX}adopt ${proj} on ${id}`,
    { createIfMissing: false },
  )
  return { slots }
}

/** Applies several reviewed discovery proposals in ONE commit (bulk create/upsert for this machine). */
export async function applyDiscoveries(
  adapter: PlatformAdapter,
  inputs: ApplyDiscoveryInput[],
  machineId?: string,
): Promise<{ projects: number; slots: number; created: number }> {
  const id = machineId ?? (await currentMachineId(adapter))
  if (!id) {
    throw new AppError(
      'machine.notRegisteredAddProject',
      'Machine not registered; register before adding projects.',
    )
  }
  const prepared = inputs.map((inp) => normalizeProject(adapter, inp))
  const slots = prepared.reduce((n, p) => n + p.writes.length, 0)
  let created = 0
  await commitConfigChange(
    adapter,
    `${COMMIT_PREFIX}scan ${prepared.length} projects on ${id}`,
    (config) => {
      created = 0
      // Phase 1: neutralize self-overlap across ALL projects before snapshotting.
      for (const np of prepared) neutralizeSelfOverlap(config, np, id)
      // Phase 2: one shared claimed set; Phase 3: write each project against it.
      const claimed = machineSyncedPaths(config, adapter, id)
      for (const np of prepared) {
        if (!config.projects[np.proj]) created++
        writeProjectSlots(config, np, id, claimed)
      }
    },
  )
  return { projects: prepared.length, slots, created }
}

/** True when `p` is `root` itself or nested under it (boundary-aware). */
function isUnder(root: string, p: string): boolean {
  const r = resolve(root)
  const q = resolve(p)
  return q === r || q.startsWith(r + sep)
}

/**
 * Bulk scan apply: for any dir-slot whose path is missing AND lives under
 * ~/.claude/projects, create the folder first (the "activate memory" onboarding),
 * then write every project in one commit. The projects-root bound keeps the
 * renderer from asking the app to create arbitrary directories.
 */
export async function applyScan(
  adapter: PlatformAdapter,
  inputs: ApplyDiscoveryInput[],
  machineId?: string,
): Promise<{ projects: number; slots: number; created: number }> {
  const projectsRoot = join(adapter.claudeHome(), 'projects')
  for (const inp of inputs) {
    for (const s of inp.slots) {
      if (s.kind !== 'dir') continue
      const path = adapter.expandHome(s.path.trim())
      if (!isUnder(projectsRoot, path) || (await pathExists(path))) continue
      await mkdir(path, { recursive: true })
    }
  }
  return applyDiscoveries(adapter, inputs, machineId)
}

/** Read-only: scans ~/.claude/projects on THIS machine into a bulk-create checklist. */
export async function scanProjects(adapter: PlatformAdapter): Promise<ScannedProject[]> {
  const machineId = await currentMachineId(adapter)
  if (!machineId) {
    throw new AppError(
      'machine.notRegisteredAddProject',
      'Machine not registered; register before adding projects.',
    )
  }
  const config = await loadRepoConfig(adapter)
  return scanClaudeProjects(join(adapter.claudeHome(), 'projects'), config, adapter, machineId)
}

/** Read-only: scans a selected directory on THIS machine and returns a discovery proposal for the UI to review. */
export async function discoverProject(
  adapter: PlatformAdapter,
  selectedDir: string,
): Promise<DiscoveryProposal> {
  const machineId = await currentMachineId(adapter)
  if (!machineId) {
    throw new AppError(
      'machine.notRegisteredAddProject',
      'Machine not registered; register before adding projects.',
    )
  }
  const config = await loadRepoConfig(adapter)
  return discoverProjectSources(selectedDir, config, adapter, machineId)
}

/**
 * Read-only: given a directory the user just picked for a project `dir` slot,
 * returns the corrected path (redirecting a project root to its `<slot>` child so
 * it maps flat, not nested). Resilient by design — the picker must never break, so
 * a missing machine id or unreadable repo config degrades to a name-only decision.
 */
export async function suggestFolderCorrection(
  adapter: PlatformAdapter,
  projectName: string,
  slot: string,
  pickedPath: string,
  kind: 'file' | 'dir',
): Promise<FolderPickCorrection> {
  const machineId = (await currentMachineId(adapter)) ?? ''
  let config: Config
  try {
    config = await loadRepoConfig(adapter)
  } catch {
    config = emptyConfig('')
  }
  return correctProjectFolderPick(pickedPath, projectName, slot, kind, config, adapter, machineId)
}

/** Read-only: builds the cross-machine adoption proposal for a project on THIS machine. */
export async function proposeAdoption(
  adapter: PlatformAdapter,
  projectName: string,
): Promise<MachineMappingProposal> {
  const machineId = await currentMachineId(adapter)
  if (!machineId) throw new AppError('machine.notRegistered', 'Machine not registered.')
  const config = await loadRepoConfig(adapter)
  return proposeMachineMapping(projectName, machineId, config, adapter)
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
  await commitConfigChange(adapter, `${COMMIT_PREFIX}pin ${pin} on ${id}`, (config) => {
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
  await commitConfigChange(adapter, `${COMMIT_PREFIX}unpin ${pinId}`, (config) => {
    if (config.pinnedFiles) delete config.pinnedFiles[pinId]
  })
}

// ── conflicts ───────────────────────────────────────────────────────────────
export async function listConflicts(adapter: PlatformAdapter): Promise<string[]> {
  return repoGit(adapter).listConflicts()
}

export async function resolveConflict(
  adapter: PlatformAdapter,
  file: string,
  side: 'local' | 'remote',
): Promise<void> {
  // Delegates so the modify/delete handling (#136) lives in exactly one place.
  await resolveConflictFile(repoGit(adapter), file, side)
}

/**
 * Resolves every conflict confined to a Claude-managed subtree as a DELETION —
 * this version purges those paths from the repo anyway (#135) — and, when nothing
 * else is left, completes the merge with git's default message (hidden from the
 * activity feed: the user didn't resolve anything). Returns the conflicts that
 * still need the user, and whether the merge got completed here.
 */
async function resolveManagedConflicts(
  git: Git,
): Promise<{ remaining: string[]; completed: boolean }> {
  const conflicted = await git.listConflicts()
  const managed = conflicted.filter((p) => isManagedRepoPath(p))
  const remaining = conflicted.filter((p) => !isManagedRepoPath(p))
  if (managed.length === 0) return { remaining, completed: false }
  await git.rm(managed, { force: true })
  if (remaining.length > 0 || !(await git.mergeInProgress())) return { remaining, completed: false }
  await git.completeMerge()
  return { remaining, completed: true }
}

/**
 * `git pull` (merge) that never stalls on Claude-managed files (#135): their
 * conflicts are auto-resolved (see `resolveManagedConflicts`), so the caller
 * carries on exactly as after a clean pull. Real conflicts come back untouched.
 */
async function pullMerge(git: Git): Promise<PullResult> {
  const r = await git.pull()
  if (r.ok) return r
  const { remaining } = await resolveManagedConflicts(git)
  return remaining.length > 0 ? { ok: false, conflicted: remaining } : { ok: true, conflicted: [] }
}

export interface HealResult {
  /** conflicts the user still has to resolve (none are Claude-managed) */
  remaining: string[]
  /** true when the stuck merge was completed here */
  completed: boolean
  /** true when that completed merge also reached the remote */
  pushed: boolean
}

/**
 * Self-heal for a working copy left stuck in a merge whose conflicts are, at least
 * partly, Claude-managed files — e.g. by an older version before #135, which froze a
 * real machine for days. Those are resolved as deletions; if nothing else is left the
 * merge is completed and pushed. The caller must then land the result with
 * `incomingResolved` (never an outgoing first — see there). No-op without conflicts.
 */
export async function healManagedConflicts(adapter: PlatformAdapter): Promise<HealResult> {
  const git = repoGit(adapter)
  const { remaining, completed } = await resolveManagedConflicts(git)
  if (!completed) return { remaining, completed, pushed: false }
  const push = await git.push()
  return { remaining, completed, pushed: push.ok }
}

const CLEANUP_COMMIT = `${COMMIT_PREFIX}remove Claude Code managed cache`

/**
 * Repo hygiene (#135): drops the Claude-managed subtrees (`managedRepoPaths`) from
 * the working copy — index AND disk, untracked leftovers included — and git-ignores
 * them, as ONE local commit limited to those paths (a concurrent flow's staged
 * changes are never swept in). The caller's push carries it. History is NOT
 * rewritten: past commits keep their copy. Idempotent: false when already clean.
 * Never runs mid-merge — `resolveManagedConflicts` heals that case — so these
 * deletions are never folded into somebody else's merge commit.
 */
async function purgeManaged(git: Git): Promise<boolean> {
  if (await git.mergeInProgress()) return false
  const roots = managedRepoPaths()
  const tracked = await git.lsFiles(roots)
  const ignoreChanged = await ensureGitIgnore(git.cwd)
  if (tracked.length > 0) await git.rm(roots, { recursive: true, force: true })
  for (const r of roots) await rm(join(git.cwd, r), { recursive: true, force: true })
  if (tracked.length === 0 && !ignoreChanged) return false
  await git.add(['.gitignore'])
  const paths = tracked.length > 0 ? ['.gitignore', ...roots] : ['.gitignore']
  return (await git.commitPaths(CLEANUP_COMMIT, paths)).committed
}

/**
 * Removes the Claude-managed cache from the repo (see `purgeManaged`) and commits
 * locally. True when it committed something the caller still has to push.
 */
export function purgeManagedFromRepo(adapter: PlatformAdapter): Promise<boolean> {
  return purgeManaged(repoGit(adapter))
}

/**
 * Narrows an incoming after a completed merge (a manual resolution or a heal) to
 * the actions that don't destroy machine-side work: one applies only when the
 * machine still holds exactly what it last committed — the merge's first parent.
 * A file the machine changed AFTER that commit (e.g. edited while sync sat paused
 * on the conflict) is left as is: those bytes exist nowhere else, and the next
 * regular cycle pushes them. Before this, the post-resolution incoming silently
 * reverted such edits to their pre-conflict version. HEAD not a merge → unchanged.
 */
export async function keepMachineEdits(
  adapter: PlatformAdapter,
  actions: PlanAction[],
): Promise<PlanAction[]> {
  const git = repoGit(adapter)
  const base = (await git.revParse('HEAD^2')) ? await git.revParse('HEAD^1') : null
  if (!base) return actions
  const ctx = await buildContext(adapter)
  const kept: PlanAction[] = []
  for (const a of actions) {
    if (!a.to) continue
    const committed = await git.blobId(base, a.logicalPath)
    if ((await machineObjectId(git, ctx, a)) === committed) kept.push(a)
  }
  return kept
}

/**
 * Git object id of what this machine would contribute for an incoming action's
 * path right now — the shared split for settings.json, the raw bytes otherwise —
 * or null when the machine doesn't have it.
 */
async function machineObjectId(git: Git, ctx: SyncContext, a: PlanAction): Promise<string | null> {
  if (a.transform) {
    const shared = await machineSharedSettings(ctx)
    return shared === null ? null : git.hashObject({ content: shared })
  }
  if (!a.to || !(await pathExists(a.to))) return null
  return git.hashObject({ file: a.to })
}

/** Completes the merge and pushes if it can. */
export async function completeConflictMerge(
  adapter: PlatformAdapter,
): Promise<{ pushed: boolean }> {
  const git = repoGit(adapter)
  await git.completeMerge(`${COMMIT_PREFIX}resolve conflicts`)
  const push = await git.push()
  return { pushed: push.ok }
}

// ── status ──────────────────────────────────────────────────────────────────
export function repoStatus(adapter: PlatformAdapter): Promise<RepoStatus> {
  return repoGit(adapter).status()
}

/**
 * Activity history (#8): the repo's git log classified into typed entries, MERGED
 * with the local incoming ledger (incoming never commits, so it isn't in git).
 * Merges, the initial-structure seed and external commits are filtered out; the
 * combined list is sorted newest-first and capped to `limit`.
 */
export async function history(adapter: PlatformAdapter, limit = 50): Promise<HistoryEntry[]> {
  const raw = await repoGit(adapter).log(limit)
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
  const r = await pullMerge(repoGit(adapter))
  return { ok: r.ok, conflicts: r.conflicted }
}

// ── sync context (config + identity + local overrides) ──────────────────────
async function buildContext(adapter: PlatformAdapter): Promise<SyncContext> {
  const config = await loadRepoConfig(adapter)
  const local = await loadLocalState(adapter)
  if (!local) {
    throw new AppError(
      'machine.notRegisteredLocal',
      'Machine not registered (local.json missing). Run `engram register`.',
    )
  }
  // Removed from the repo by another machine: stop here rather than keep syncing as an
  // invisible machine with no project paths. Registering again lets it rejoin.
  if (!config.machines[local.machineId]) {
    throw new AppError(
      'machine.notInRepo',
      `This machine ("${local.machineId}") was removed from the repo. Register it again to resume syncing: engram register --name ${local.machineId}`,
      { machineId: local.machineId },
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
  /** git's stderr when the push failed (so the caller can tell why), else undefined */
  pushError?: string
}

/** Runs the outgoing sync (machine → working copy) and syncs with the remote. */
export async function syncOutgoing(
  adapter: PlatformAdapter,
  plan: Plan,
  opts: { force?: boolean } = {},
): Promise<OutgoingResult> {
  const git = repoGit(adapter)
  const ctx = await buildContext(adapter)
  // Repo hygiene first (#135): its own commit, carried by this flow's push.
  const purged = await purgeManaged(git)
  const exec = await executePlan(plan, ctx, opts)

  await git.add()
  // Stamp the machine so the activity history (#8) can attribute and direct (↑/↓) it.
  const c = await git.commit(`${COMMIT_PREFIX}outgoing on ${ctx.machineId}`)
  if (!c.committed && !purged) return { exec, conflicts: [], pushed: false, committed: false }

  const pull = await pullMerge(git)
  if (!pull.ok) return { exec, conflicts: pull.conflicted, pushed: false, committed: true }
  // Again after integrating the remote: an older version may have pushed the cache back.
  await purgeManaged(git)

  let push = await git.push()
  if (!push.ok && push.rejected) {
    const p2 = await pullMerge(git)
    if (!p2.ok) return { exec, conflicts: p2.conflicted, pushed: false, committed: true }
    push = await git.push()
  }
  return {
    exec,
    conflicts: [],
    pushed: push.ok,
    committed: true,
    pushError: push.ok ? undefined : push.stderr.trim(),
  }
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

  const git = repoGit(adapter)
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
