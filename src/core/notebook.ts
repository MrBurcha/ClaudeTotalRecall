import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { AppError } from './errors'
import { readMemoryFilePreview } from './filePreview'
import { Git } from './git'
import { isSecretExcluded } from './plan'
import { withRepoLock } from './repoLock'
import { loadRepoConfig, workingCopyDir } from './service'
import type { NotebookFile, NotebookNode, NotebookRoot, NotebookTree } from './types'

// Everything lives under memories/notebook/. Callers address files with paths
// relative to that root (POSIX, e.g. "general/idea.md"); this module resolves,
// validates and commits them. It never pushes — a save is a local commit that the
// normal sync cycle (or a manual "Sync now") pushes later. Every mutation runs
// under withRepoLock so it can never interleave with a config edit's reset flow.
const NOTEBOOK_REL = 'memories/notebook'
const GENERAL = 'general'
const PROJECTS = 'projects'

function notebookGit(adapter: PlatformAdapter): Git {
  return new Git(workingCopyDir(adapter))
}

function notebookRoot(adapter: PlatformAdapter): string {
  return join(workingCopyDir(adapter), NOTEBOOK_REL)
}

/** Repo-relative path (from the working-copy root) of a notebook-relative path. */
function repoRel(rel: string): string {
  return posix.join(NOTEBOOK_REL, rel)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Validates a single path segment (a note title or folder name). Permissive on
 * charset (spaces and non-ASCII titles are fine) but blocks anything that could
 * escape the notebook root or shadow a secret/structural file: separators,
 * control chars, "."/".." and leading dots, over-long names.
 */
function assertSafeSegment(seg: string): void {
  const invalid =
    seg.length === 0 ||
    seg.length > 255 ||
    seg === '.' ||
    seg === '..' ||
    seg.startsWith('.') ||
    seg !== seg.trim() ||
    seg.includes('/') ||
    seg.includes('\\') ||
    hasControlChar(seg)
  if (invalid || isSecretExcluded(seg)) {
    throw new AppError('notebook.invalidName', `Invalid Notebook name: "${seg}".`, { value: seg })
  }
}

/** Normalizes and validates a notebook-relative path (every segment). Throws on traversal. */
function assertSafeRel(rel: string): string {
  const norm = rel.replace(/\\/g, '/')
  const segs = norm.split('/').filter(Boolean)
  if (segs.length === 0) {
    throw new AppError('notebook.invalidName', 'Empty Notebook path.', { value: rel })
  }
  for (const s of segs) assertSafeSegment(s)
  return segs.join('/')
}

/** Absolute path of a validated notebook-relative path, guaranteed inside the root. */
function resolveAbs(adapter: PlatformAdapter, rel: string): string {
  const safe = assertSafeRel(rel)
  return join(notebookRoot(adapter), safe)
}

async function assertNoConflicts(git: Git): Promise<void> {
  const conflicts = await git.listConflicts()
  if (conflicts.length > 0) {
    throw new AppError(
      'notebook.repoConflict',
      'Resolve the pending sync conflicts before editing the Notebook.',
      { files: conflicts.join(', ') },
    )
  }
}

/**
 * Stages the given repo-relative paths and makes a local commit (no push),
 * LIMITED to those paths so a concurrent flow's staged changes are never swept
 * into this Notebook commit.
 */
async function commitLocal(git: Git, repoPaths: string[], message: string): Promise<void> {
  await git.add(['-A', '--', ...repoPaths])
  await git.commitPaths(message, repoPaths)
}

/** Recursively reads a directory into notebook nodes: folders first, then files, alpha. */
async function readNodes(absDir: string, relBase: string): Promise<NotebookNode[]> {
  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs: NotebookNode[] = []
  const files: NotebookNode[] = []
  for (const e of entries) {
    if (e.name === '.gitkeep') continue
    const childRel = posix.join(relBase, e.name)
    if (e.isDirectory()) {
      dirs.push({
        name: e.name,
        path: childRel,
        kind: 'dir',
        children: await readNodes(join(absDir, e.name), childRel),
      })
    } else if (e.isFile() && !isSecretExcluded(e.name)) {
      files.push({ name: e.name, path: childRel, kind: 'file' })
    }
  }
  const byName = (a: NotebookNode, b: NotebookNode) => a.name.localeCompare(b.name)
  dirs.sort(byName)
  files.sort(byName)
  return [...dirs, ...files]
}

async function listSubdirNames(absDir: string): Promise<string[]> {
  try {
    const entries = await readdir(absDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * The full Notebook tree: a "General" root plus one root per project. Project
 * roots are the UNION of configured projects and folders physically present under
 * memories/notebook/projects/, so renaming or deleting a project never loses its
 * notes (they stay visible under the old name until moved).
 */
export async function notebookTree(adapter: PlatformAdapter): Promise<NotebookTree> {
  const root = notebookRoot(adapter)
  let configured: string[] = []
  try {
    configured = Object.keys((await loadRepoConfig(adapter)).projects)
  } catch {
    configured = []
  }
  const physical = await listSubdirNames(join(root, PROJECTS))
  const names = Array.from(new Set([...configured, ...physical])).sort((a, b) => a.localeCompare(b))

  const general: NotebookRoot = {
    id: GENERAL,
    kind: 'general',
    path: GENERAL,
    children: await readNodes(join(root, GENERAL), GENERAL),
  }
  const projects: NotebookRoot[] = []
  for (const name of names) {
    const base = posix.join(PROJECTS, name)
    projects.push({
      id: name,
      kind: 'project',
      path: base,
      children: await readNodes(join(root, PROJECTS, name), base),
    })
  }
  return { roots: [general, ...projects] }
}

/** Reads a note's content from the working copy. Traversal-safe; missing → exists:false. */
export async function readNote(adapter: PlatformAdapter, rel: string): Promise<NotebookFile> {
  return readMemoryFilePreview(workingCopyDir(adapter), repoRel(rel))
}

function saveFile(
  adapter: PlatformAdapter,
  rel: string,
  content: string,
  opts: { mustNotExist: boolean },
): Promise<void> {
  return withRepoLock(async () => {
    const safe = assertSafeRel(rel)
    const git = notebookGit(adapter)
    await assertNoConflicts(git)
    const abs = resolveAbs(adapter, safe)
    const existed = await pathExists(abs)
    if (opts.mustNotExist && existed) {
      throw new AppError('notebook.exists', `A Notebook entry already exists at "${safe}".`, {
        value: safe,
      })
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    await commitLocal(git, [repoRel(safe)], `notebook: ${existed ? 'update' : 'create'} ${safe}`)
  })
}

/** Creates a new note (fails if it already exists). */
export function createNote(
  adapter: PlatformAdapter,
  input: { relPath: string; content?: string },
): Promise<void> {
  return saveFile(adapter, input.relPath, input.content ?? '', { mustNotExist: true })
}

/** Saves an edit to a note (upsert). */
export function writeNote(
  adapter: PlatformAdapter,
  input: { relPath: string; content: string },
): Promise<void> {
  return saveFile(adapter, input.relPath, input.content, { mustNotExist: false })
}

/** Creates a folder, persisted in git via a .gitkeep placeholder. */
export function createFolder(adapter: PlatformAdapter, rel: string): Promise<void> {
  return withRepoLock(async () => {
    const safe = assertSafeRel(rel)
    const git = notebookGit(adapter)
    await assertNoConflicts(git)
    const abs = resolveAbs(adapter, safe)
    if (await pathExists(abs)) {
      throw new AppError('notebook.exists', `A Notebook entry already exists at "${safe}".`, {
        value: safe,
      })
    }
    await mkdir(abs, { recursive: true })
    await writeFile(join(abs, '.gitkeep'), '')
    await commitLocal(
      git,
      [posix.join(repoRel(safe), '.gitkeep')],
      `notebook: create folder ${safe}`,
    )
  })
}

/** Renames a note or folder within its current parent. */
export async function renameEntry(
  adapter: PlatformAdapter,
  input: { relPath: string; newName: string },
): Promise<void> {
  const from = assertSafeRel(input.relPath)
  assertSafeSegment(input.newName)
  const parent = posix.dirname(from)
  const to = parent === '.' ? input.newName : posix.join(parent, input.newName)
  await relocate(adapter, from, to)
}

/** Moves a note or folder into another container (its base name is kept). */
export async function moveEntry(
  adapter: PlatformAdapter,
  input: { relPath: string; toDir: string },
): Promise<void> {
  const from = assertSafeRel(input.relPath)
  const dir = assertSafeRel(input.toDir)
  const to = posix.join(dir, posix.basename(from))
  if (to === from || to.startsWith(from + '/')) {
    throw new AppError('notebook.invalidMove', 'Cannot move an entry into itself.', { value: from })
  }
  await relocate(adapter, from, to)
}

/** Shared move/rename: fs rename + a scoped local commit that records both sides. */
function relocate(adapter: PlatformAdapter, from: string, to: string): Promise<void> {
  return withRepoLock(async () => {
    const git = notebookGit(adapter)
    await assertNoConflicts(git)
    const fromAbs = resolveAbs(adapter, from)
    const toAbs = resolveAbs(adapter, to)
    if (!(await pathExists(fromAbs))) {
      throw new AppError('notebook.notFound', `No Notebook entry at "${from}".`, { value: from })
    }
    if (await pathExists(toAbs)) {
      throw new AppError('notebook.exists', `A Notebook entry already exists at "${to}".`, {
        value: to,
      })
    }
    await mkdir(dirname(toAbs), { recursive: true })
    await rename(fromAbs, toAbs)
    await commitLocal(git, [repoRel(from), repoRel(to)], `notebook: move ${from} -> ${to}`)
  })
}

/** Deletes a note or folder (recursively). Idempotent when the entry is already gone. */
export function deleteEntry(adapter: PlatformAdapter, rel: string): Promise<void> {
  return withRepoLock(async () => {
    const safe = assertSafeRel(rel)
    const git = notebookGit(adapter)
    await assertNoConflicts(git)
    const abs = resolveAbs(adapter, safe)
    if (!(await pathExists(abs))) return
    await rm(abs, { recursive: true, force: true })
    await commitLocal(git, [repoRel(safe)], `notebook: delete ${safe}`)
  })
}
