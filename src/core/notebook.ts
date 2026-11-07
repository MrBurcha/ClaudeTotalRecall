import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { AppError } from './errors'
import { MAX_PREVIEW_BYTES, readMemoryFilePreview } from './filePreview'
import type { CommitResult, FileLogEntry, Git } from './git'
import { compareHits, matchNote, normalizeQuery } from './notebookSearch'
import { isSecretExcluded } from './plan'
import { withRepoLock } from './repoLock'
import { loadRepoConfig, repoGit, workingCopyDir } from './service'
import type {
  FileChange,
  NotebookDiff,
  NotebookFile,
  NotebookHistory,
  NotebookNode,
  NotebookRoot,
  NotebookSearchHit,
  NotebookSearchResult,
  NotebookTree,
  NotebookVersion,
  NotebookVersionKind,
} from './types'
import { parseUnifiedDiff } from './unifiedDiff'

// Everything lives under memories/notebook/. Callers address files with paths
// relative to that root (POSIX, e.g. "general/idea.md"); this module resolves,
// validates and commits them. It never pushes — a save is a local commit that the
// normal sync cycle (or a manual "Sync now") pushes later. Every mutation runs
// under withRepoLock so it can never interleave with a config edit's reset flow.
const NOTEBOOK_REL = 'memories/notebook'
const GENERAL = 'general'
const PROJECTS = 'projects'

function notebookGit(adapter: PlatformAdapter): Git {
  return repoGit(adapter)
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
async function commitLocal(git: Git, repoPaths: string[], message: string): Promise<CommitResult> {
  await git.add(['-A', '--', ...repoPaths])
  return git.commitPaths(message, repoPaths)
}

/**
 * The one write path for a note's content: write the file and make the scoped
 * local commit. A normal Save and a version restore both go through it. Callers
 * must already hold the repo lock and have validated `safe`.
 */
async function writeAndCommit(
  adapter: PlatformAdapter,
  git: Git,
  safe: string,
  content: string,
  message: string,
): Promise<CommitResult> {
  const abs = resolveAbs(adapter, safe)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
  return commitLocal(git, [repoRel(safe)], message)
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
  let configured: string[]
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
    await writeAndCommit(
      adapter,
      git,
      safe,
      content,
      `notebook: ${existed ? 'update' : 'create'} ${safe}`,
    )
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

// ── Version history (#107) ───────────────────────────────────────────────────
// Every Save is a commit, so a note's history is just `git log --follow` on its
// file. Reads never take the repo lock (git readers are lock-free); only a restore
// writes, and it goes through the same locked write+commit path as a Save.

/** Most commits listed for one note. */
export const HISTORY_LIMIT = 200

/** A full or abbreviated object id. Never an option, a ref name or a range. */
const HASH_RE = /^[0-9a-f]{7,64}$/i

function assertHash(hash: string): string {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    throw new AppError('notebook.invalidVersion', 'Invalid Notebook version id.', {
      value: String(hash),
    })
  }
  return hash.toLowerCase()
}

const NOTEBOOK_PREFIX = `${NOTEBOOK_REL}/`

/** Notebook-relative form of a repo path, or null when it is outside the Notebook or unsafe. */
function toNotebookRel(repoPath: string): string | null {
  if (!repoPath.startsWith(NOTEBOOK_PREFIX)) return null
  try {
    return assertSafeRel(repoPath.slice(NOTEBOOK_PREFIX.length))
  } catch {
    return null
  }
}

/**
 * What a commit did to the note: from the Notebook's own commit subjects first
 * (`notebook: <verb> …`, which also tells a restore apart from an edit), else from
 * git's per-file status (a commit made by some other flow).
 */
export function versionKind(
  subject: string,
  status: FileChange['status'] | null,
): NotebookVersionKind {
  const verb = /^notebook: (create|update|move|restore|delete) /.exec(subject)?.[1]
  switch (verb) {
    case 'create':
      return 'create'
    case 'update':
      return 'update'
    case 'move':
      return 'rename'
    case 'restore':
      return 'restore'
    case 'delete':
      return 'delete'
  }
  switch (status) {
    case 'added':
      return 'create'
    case 'modified':
      return 'update'
    case 'renamed':
      return 'rename'
    case 'deleted':
      return 'delete'
    default:
      return 'other'
  }
}

/**
 * Maps `git log --follow` rows (newest first) to versions. A merge row carries no
 * per-file data, so it inherits the path the note had just before the newer rows
 * (for a rename, the name it had BEFORE that commit).
 */
export function toVersions(
  entries: FileLogEntry[],
  currentRepoPath: string,
  currentBlob: string | null,
): NotebookVersion[] {
  let carry = currentRepoPath
  return entries.map((e) => {
    const repoPath = e.path ?? carry
    carry = e.status === 'renamed' && e.fromPath ? e.fromPath : repoPath
    const rel = toNotebookRel(repoPath)
    return {
      hash: e.hash,
      shortHash: e.hash.slice(0, 7),
      at: e.at,
      author: e.author,
      subject: e.subject,
      kind: versionKind(e.subject, e.status),
      path: rel ?? '',
      available: rel !== null && e.status !== 'deleted',
      current: e.blob !== null && e.blob === currentBlob,
    }
  })
}

/** The commits that touched a note, newest first, following renames/moves. */
export async function noteHistory(adapter: PlatformAdapter, rel: string): Promise<NotebookHistory> {
  const safe = assertSafeRel(rel)
  const git = notebookGit(adapter)
  const abs = resolveAbs(adapter, safe)
  const rows = await git.logFollow(repoRel(safe), HISTORY_LIMIT + 1)
  const currentBlob = (await pathExists(abs)) ? await git.hashObject({ file: abs }) : null
  return {
    versions: toVersions(rows.slice(0, HISTORY_LIMIT), repoRel(safe), currentBlob),
    truncated: rows.length > HISTORY_LIMIT,
  }
}

const MISSING_FILE: NotebookFile = {
  content: '',
  size: 0,
  truncated: false,
  binary: false,
  exists: false,
}

/** Shapes blob content like a working-copy read (NUL → binary, > 1 MiB → truncated). */
function toNotebookFile(content: string, size: number): NotebookFile {
  if (content.includes('\0')) {
    return { content: '', size, truncated: false, binary: true, exists: true }
  }
  if (size <= MAX_PREVIEW_BYTES) {
    return { content, size, truncated: false, binary: false, exists: true }
  }
  const head = Buffer.from(content, 'utf8').subarray(0, MAX_PREVIEW_BYTES).toString('utf8')
  return { content: head, size, truncated: true, binary: false, exists: true }
}

/**
 * A past version of a note: its content at commit `hash`, where `path` is the
 * note's notebook-relative path AT that commit (from {@link noteHistory}).
 * Read-only; traversal-safe (the path is validated and confined to the Notebook).
 */
export async function readNoteVersion(
  adapter: PlatformAdapter,
  input: { hash: string; path: string },
): Promise<NotebookFile> {
  const spec = `${assertHash(input.hash)}:${repoRel(assertSafeRel(input.path))}`
  const git = notebookGit(adapter)
  const size = await git.objectSize(spec)
  const content = size === null ? null : await git.showBlob(spec)
  return content === null || size === null ? MISSING_FILE : toNotebookFile(content, size)
}

function versionNotFound(rel: string): AppError {
  return new AppError('notebook.versionNotFound', `That version of "${rel}" is not available.`, {
    value: rel,
  })
}

/**
 * Unified diff from a past version (old side) to the note's current content on
 * disk (new side), straight from `git diff`. The current file is named by its
 * blob id; when that exact content isn't in the object store yet (an uncommitted
 * edit — rare, since every Save commits) it is stored first with `hash-object -w`,
 * an inert content-addressed write that touches no ref, index or file.
 */
export async function diffNoteVersion(
  adapter: PlatformAdapter,
  input: { relPath: string; hash: string; path: string },
): Promise<NotebookDiff> {
  const safe = assertSafeRel(input.relPath)
  const oldSpec = `${assertHash(input.hash)}:${repoRel(assertSafeRel(input.path))}`
  const git = notebookGit(adapter)
  const abs = resolveAbs(adapter, safe)
  if (!(await pathExists(abs))) {
    throw new AppError('notebook.notFound', `No Notebook entry at "${safe}".`, { value: safe })
  }
  if ((await git.objectSize(oldSpec)) === null) throw versionNotFound(safe)
  let current = await git.hashObject({ file: abs })
  if ((await git.objectSize(current)) === null) current = await git.hashObject({ file: abs }, true)
  const parsed = parseUnifiedDiff(await git.diffBlobs(oldSpec, current))
  return { ...parsed, identical: parsed.hunks.length === 0 && !parsed.binary }
}

/**
 * Restores a past version: writes its content to the note's CURRENT path through
 * the same locked write+commit path as a Save (a local commit `notebook: restore
 * <rel> to <short>`, pushed by the next sync like any save). The current content
 * stays in history, so a restore can itself be undone. `committed:false` when the
 * note already had exactly that content.
 */
export function restoreNoteVersion(
  adapter: PlatformAdapter,
  input: { relPath: string; hash: string; path: string },
): Promise<{ committed: boolean }> {
  return withRepoLock(async () => {
    const safe = assertSafeRel(input.relPath)
    const hash = assertHash(input.hash)
    const spec = `${hash}:${repoRel(assertSafeRel(input.path))}`
    const git = notebookGit(adapter)
    await assertNoConflicts(git)
    const size = await git.objectSize(spec)
    const content = size === null ? null : await git.showBlob(spec)
    if (content === null || size === null) throw versionNotFound(safe)
    // The content travels as a UTF-8 string: refuse anything that would not
    // round-trip byte-exact (binary, or bytes that aren't valid UTF-8).
    if (content.includes('\0') || Buffer.byteLength(content, 'utf8') !== size) {
      throw new AppError(
        'notebook.versionNotText',
        'Only text versions can be restored; this one is binary or not UTF-8.',
        { value: safe },
      )
    }
    const r = await writeAndCommit(
      adapter,
      git,
      safe,
      content,
      `notebook: restore ${safe} to ${hash.slice(0, 7)}`,
    )
    return { committed: r.committed }
  })
}

// ── Full-text search (#108) ──────────────────────────────────────────────────

/** Default and maximum number of results returned. */
export const SEARCH_LIMIT = 50
const SEARCH_LIMIT_MAX = 200
/** Upper bound on files read per search, so a huge folder can't stall the app. */
const SEARCH_MAX_FILES = 5000

/**
 * Notebook-relative paths of every searchable file under `absDir`: regular files
 * only (symlinks are never followed), skipping `.gitkeep` placeholders and
 * secret-shaped names, capped at {@link SEARCH_MAX_FILES}.
 */
async function listNoteFiles(absDir: string, relBase: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    if (out.length >= SEARCH_MAX_FILES) return
    if (e.name === '.gitkeep' || isSecretExcluded(e.name)) continue
    const rel = relBase ? posix.join(relBase, e.name) : e.name
    if (e.isDirectory()) await listNoteFiles(join(absDir, e.name), rel, out)
    else if (e.isFile()) out.push(rel)
  }
}

/**
 * Case- and accent-insensitive search over note names/paths and contents in the
 * working copy's Notebook. Each file is read through the same guarded preview
 * reader as the viewer (confined to `memories/`, first 1 MiB only); binary files
 * are skipped. Name matches rank first; at most `limit` hits are returned.
 */
export async function searchNotebook(
  adapter: PlatformAdapter,
  input: { query: string; limit?: number },
): Promise<NotebookSearchResult> {
  const q = normalizeQuery(typeof input.query === 'string' ? input.query : '')
  if (!q) return { hits: [], truncated: false }
  const asked = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : null
  const limit = Math.max(1, Math.min(Math.floor(asked ?? SEARCH_LIMIT), SEARCH_LIMIT_MAX))
  const files: string[] = []
  await listNoteFiles(notebookRoot(adapter), '', files)
  const wc = workingCopyDir(adapter)
  const hits: NotebookSearchHit[] = []
  for (const rel of files) {
    const file = await readMemoryFilePreview(wc, repoRel(rel))
    if (!file.exists || file.binary) continue
    const hit = matchNote({ path: rel, name: posix.basename(rel), content: file.content }, q)
    if (hit) hits.push(hit)
  }
  hits.sort(compareHits)
  return { hits: hits.slice(0, limit), truncated: hits.length > limit }
}
