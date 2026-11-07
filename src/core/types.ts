import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Config that lives in the repo (claudetr.json). See §7/§8 of the plan.
// ─────────────────────────────────────────────────────────────────────────────

export const OsSchema = z.enum(['linux', 'macos', 'windows'])
export type Os = z.infer<typeof OsSchema>

export const MachineSchema = z.object({
  os: OsSchema,
  hostname: z.string().min(1),
  home: z.string().min(1),
})
export type Machine = z.infer<typeof MachineSchema>

/**
 * A logical project. `folders` is a map of logical slots (default "memory")
 * and each slot maps machineId → literal absolute path on that machine.
 * `slotKinds` marks a slot as a single pinpoint FILE vs a mirrored DIRECTORY;
 * a slot absent from it defaults to 'dir'. Optional/additive so an older app
 * version reads a newer config without failing (zod strips unknown keys).
 */
export const ProjectSchema = z.object({
  folders: z.record(z.string(), z.record(z.string(), z.string())),
  slotKinds: z.record(z.string(), z.enum(['file', 'dir'])).optional(),
})
export type Project = z.infer<typeof ProjectSchema>

export const ConfigSchema = z.object({
  version: z.literal(1),
  repo: z.object({
    // git accepts HTTPS, SSH (git@…) and file://; we don't enforce a URL format.
    remote: z.string().min(1),
  }),
  machines: z.record(z.string(), MachineSchema),
  projects: z.record(z.string(), ProjectSchema),
  /**
   * Global pinpoint files synced outside any project: pinId → machineId →
   * literal absolute path. Always files, mapped to `memories/pinned/<pinId>`.
   * Optional/additive (same back-compat rationale as `Project.slotKinds`).
   */
  pinnedFiles: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})
export type Config = z.infer<typeof ConfigSchema>

export function emptyConfig(remote: string): Config {
  return { version: 1, repo: { remote }, machines: {}, projects: {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local state (outside the repo, in ~/.config/claudetr/).
// ─────────────────────────────────────────────────────────────────────────────

/** Per-machine auto-sync preferences (outside the repo). See core/syncEngine.ts. */
export const AutoSyncSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().positive(),
})
export type AutoSyncPrefs = z.infer<typeof AutoSyncSchema>

export const LocalStateSchema = z.object({
  machineId: z.string().min(1),
  autoSync: AutoSyncSchema.optional(),
  /**
   * gh login that reaches the memories repo, remembered after the active gh account
   * couldn't (see core/gitAuth.ts). Per machine: accounts are a local matter.
   */
  githubAccount: z.string().min(1).optional(),
})
export type LocalState = z.infer<typeof LocalStateSchema>

/** settings.json is an arbitrary JSON object; the merge is shallow per top-level key. */
export type SettingsObject = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// Plan (mandatory dry-run). See §10.
// ─────────────────────────────────────────────────────────────────────────────

export type Verb = 'outgoing' | 'incoming'

export type PlanActionType =
  | 'create' // the destination doesn't exist
  | 'overwrite' // the destination exists and changes (different hash)
  | 'delete' // the destination exists and is extraneous
  | 'noop' // source and destination identical (same hash)
  | 'skip' // slot with no path for this machine, or excluded by guard

export interface PlanAction {
  /** readable id of the slot/file, e.g. "user:CLAUDE.md" or "project:demo-core/memory/foo.md" */
  slot: string
  /** logical path within the repo (relative to the working copy root) */
  logicalPath: string
  /** absolute source path (null if not applicable) */
  from: string | null
  /** absolute destination path (null if not applicable) */
  to: string | null
  type: PlanActionType
  hashFrom?: string
  hashTo?: string
  /** human reason, mostly for skip/delete (English default; localized by reasonCode) */
  reason?: string
  /** stable code the renderer maps to a localized reason ('planReason.<reasonCode>') */
  reasonCode?: string
  /** interpolation params for the localized reason (e.g. { machine }) */
  reasonParams?: Record<string, string | number>
  /**
   * Marks actions whose content is NOT a direct copy but a computation
   * (the settings.json merge/split, §6). The executor recomputes the content
   * instead of copying the file.
   */
  transform?: 'settings-outgoing' | 'settings-incoming'
}

export interface Plan {
  id: string
  verb: Verb
  /** ISO timestamp; stamped by whoever builds the Plan (injected, not an internal Date.now) */
  createdAt: string
  actions: PlanAction[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo status and preflight.
// ─────────────────────────────────────────────────────────────────────────────

export interface RepoStatus {
  branch: string
  ahead: number
  behind: number
  dirty: boolean
  conflicted: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity history (#8): derived from the repo's git log, presented in app terms.
// ─────────────────────────────────────────────────────────────────────────────

export type HistoryType =
  | 'outgoing' // a machine pushed its memory (↑ local / ↓ from another machine)
  | 'incoming' // this machine pulled shared memory in (recorded locally, not in git)
  | 'set-folder'
  | 'remove-folder'
  | 'new-project'
  | 'delete-project'
  | 'rename-project'
  | 'register'
  | 'pin'
  | 'unpin'
  | 'conflicts'
  | 'notebook'
  | 'cleanup' // the app removed Claude Code's managed cache from the repo (#135)
  | 'other'

/** A single file touched by a commit, as reported by `git log --name-status`. */
export interface FileChange {
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'other'
  /** repo-relative path (for renames, the new path) */
  path: string
}

export interface HistoryEntry {
  hash: string
  /** ISO timestamp (author date) */
  at: string
  type: HistoryType
  /** machine that produced it, when the commit message carries it */
  machineId?: string
  project?: string
  slot?: string
  from?: string
  to?: string
  pin?: string
  /** source machine(s) an `incoming` entry received from (best-effort; distinct from `from`) */
  fromMachines?: string[]
  /** number of files changed in the commit */
  files: number
  /** the files touched (added/modified/deleted), for the activity detail (#8) */
  changes: FileChange[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Notebook (#104): a cloud-native notes/prompts space stored under
// memories/notebook/. Unlike the mirror buckets it has no per-machine path and
// isn't part of the Plan — it lives only in the working copy and rides the normal
// git sync. Paths below are relative to memories/notebook/ (POSIX, no leading slash).
// ─────────────────────────────────────────────────────────────────────────────

/** A file or folder inside a Notebook root. */
export interface NotebookNode {
  /** last path segment (the note title / folder name) */
  name: string
  /** path relative to memories/notebook/, e.g. "general/ideas.md" */
  path: string
  kind: 'file' | 'dir'
  /** child nodes (dirs only; files omit it) */
  children?: NotebookNode[]
}

/** A top-level container: the "general" bucket or one per project. */
export interface NotebookRoot {
  /** 'general' or the canonical project name */
  id: string
  kind: 'general' | 'project'
  /** base path relative to memories/notebook/: "general" or "projects/<name>" */
  path: string
  children: NotebookNode[]
}

export interface NotebookTree {
  roots: NotebookRoot[]
}

/** Content + metadata of a Notebook file, for the viewer/editor. */
export interface NotebookFile {
  /** UTF-8 content from the working copy; empty when binary or missing */
  content: string
  size: number
  truncated: boolean
  binary: boolean
  exists: boolean
}

/** What a commit did to a note, for the version-history list (#107). */
export type NotebookVersionKind = 'create' | 'update' | 'rename' | 'restore' | 'delete' | 'other'

/** One commit in a note's history (newest first), following renames/moves. */
export interface NotebookVersion {
  hash: string
  shortHash: string
  /** ISO author date */
  at: string
  author: string
  subject: string
  kind: NotebookVersionKind
  /** notebook-relative path of the note AT this commit (differs from today's after a rename) */
  path: string
  /** false for a deletion (or a path outside the Notebook): there is no content to show */
  available: boolean
  /** this version's bytes are identical to the note on disk right now */
  current: boolean
}

export interface NotebookHistory {
  versions: NotebookVersion[]
  /** more commits exist than the ones listed (the list is capped) */
  truncated: boolean
}

/** One line of a unified diff. `note` = git's "\ No newline at end of file" marker. */
export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'note'
  text: string
  /** 1-based line number on the old side (del/ctx) */
  oldNo?: number
  /** 1-based line number on the new side (add/ctx) */
  newNo?: number
}

export interface DiffHunk {
  /** the raw "@@ -a,b +c,d @@ …" header */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

/** A past version compared with the note's current content (old → current). */
export interface NotebookDiff {
  hunks: DiffHunk[]
  /** no differences at all */
  identical: boolean
  /** git reported a binary difference (no line diff available) */
  binary: boolean
  /** the diff was longer than the display cap and was cut */
  truncated: boolean
}

/** [start, end) UTF-16 offsets of a highlighted match inside a string. */
export type TextRange = [number, number]

/** A Notebook full-text search result (#108). */
export interface NotebookSearchHit {
  /** notebook-relative path, e.g. "general/ideas.md" */
  path: string
  /** the file name (last path segment) */
  name: string
  /** matches inside `name`, for highlighting */
  nameRanges: TextRange[]
  /** the query matched the note's name or folder path */
  nameMatch: boolean
  /** number of matches in the content */
  contentMatches: number
  /** a short line of context: the first content match (highlighted), else the first line */
  snippet: { text: string; ranges: TextRange[] } | null
}

export interface NotebookSearchResult {
  hits: NotebookSearchHit[]
  /** more notes matched than the result cap */
  truncated: boolean
}

/** Content + machine location of a memories file, for the preview modal (#43). */
export interface FilePreview {
  /** UTF-8 content from the repo working copy; empty when binary or missing */
  content: string
  /** full byte size on disk (even when truncated) */
  size: number
  truncated: boolean
  binary: boolean
  exists: boolean
  /** the file's real path on THIS machine, or null if not mapped/present here */
  sourcePath: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Local activity log (outside the repo). Incoming syncs never commit or touch
// the remote, so their trace can't come from git; we record them locally here
// and merge them into history() to complete the ledger. Never synced.
// ─────────────────────────────────────────────────────────────────────────────

export const FileChangeSchema = z.object({
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'other']),
  path: z.string(),
})

/** One recorded incoming sync: what landed on this machine, and from whom. */
export const IncomingRecordSchema = z.object({
  /** stable id (reuses the Plan id) — used as the React key */
  id: z.string(),
  /** ISO timestamp (reuses the Plan createdAt, injected — no internal Date.now) */
  at: z.string(),
  /** source machineId(s), best-effort from the pulled commits (may be empty) */
  fromMachines: z.array(z.string()),
  changes: z.array(FileChangeSchema),
})
export type IncomingRecord = z.infer<typeof IncomingRecordSchema>

export const ActivityLogSchema = z.object({
  version: z.literal(1),
  /** working-copy HEAD when the last record was written; anchors `from` attribution */
  lastHead: z.string().optional(),
  incoming: z.array(IncomingRecordSchema),
})
export type ActivityLog = z.infer<typeof ActivityLogSchema>

export interface PreflightCheck {
  name: 'git' | 'gh' | 'gh-auth'
  ok: boolean
  /** English default; the renderer prefers detailKey when present (path/stderr stay literal) */
  detail?: string
  /** actionable suggestion if !ok (command or link); English default, see fixKey */
  fix?: string
  /** stable code the renderer maps to a localized detail ('preflight.<detailKey>') */
  detailKey?: string
  /** stable code the renderer maps to a localized fix ('preflight.<fixKey>') */
  fixKey?: string
  /** interpolation params for the localized detail/fix */
  params?: Record<string, string | number>
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-sync engine state (pushed by main → renderer in real time).
// Lives in core/types so renderer and preload can import it type-only without
// crossing the layering rule. The concrete scheduler lives in main/syncScheduler.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type SyncStatus =
  | 'idle' // up to date
  | 'syncing' // running a cycle
  | 'offline' // the network failed; retries on the next poll (amber)
  | 'error' // any other failure (no repo access, git, fs…); still retried, but shown as such (#132)
  | 'conflict' // merge conflict to resolve by hand (red, auto paused)

/**
 * Where a failed remote operation came from: the network itself, the remote refusing
 * access (auth, missing repo, no permission), or anything else. See core/gitAuth.ts.
 */
export type RemoteErrorKind = 'network' | 'access' | 'other'

export interface SyncEngineState {
  status: SyncStatus
  /** preference: is auto-sync enabled? (poll/watch run only if true) */
  auto: boolean
  /** how often the remote is polled (ms) */
  intervalMs: number
  /** epoch ms of the last successful cycle, or null if none yet this session */
  lastSyncedAt: number | null
  /** files in conflict (empty unless status is 'conflict') */
  conflicts: string[]
  /** raw text of the last failure (null unless status is 'offline' or 'error') */
  lastError: string | null
  /** what kind of failure `lastError` is (null when there's none) */
  errorKind: RemoteErrorKind | null
  /**
   * Another process holds this machine's sync lock (#141): a second app copy
   * (`kind: 'app'`) or a CLI command (`'cli'`); pid 0 = unknown holder. While set,
   * this copy doesn't sync and refuses changes. null = this process owns the machine.
   */
  blockedBy: { kind: 'app' | 'cli'; pid: number } | null
}
