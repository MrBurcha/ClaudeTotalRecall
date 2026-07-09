import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { loadActivityLog, recordIncoming, seedActivityHead } from './activityLog'
import { loadConfig, saveConfig } from './config'
import { AppError } from './errors'
import { readMemoryFilePreview } from './filePreview'
import { Git } from './git'
import { classifyCommit } from './history'
import {
  ensureSettingsLocal,
  loadLocalState,
  loadSettingsLocal,
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
import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import { machinePathForLogical, machineSyncedPaths, pathsCollide } from './resolve'
import {
  emptyConfig,
  type Config,
  type FileChange,
  type FilePreview,
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
  await commitConfigChange(adapter, `Claude Total Recall: new project ${proj}`, (config) => {
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
    `Claude Total Recall: discover ${proj} on ${id}`,
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
    `Claude Total Recall: adopt ${proj} on ${id}`,
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
    `Claude Total Recall: scan ${prepared.length} projects on ${id}`,
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
