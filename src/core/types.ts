import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Config that lives in the repo (claudetr.json). See §7/§8 of the plan.
// ─────────────────────────────────────────────────────────────────────────────

export const OsSchema = z.enum(['linux', 'macos']) // 'windows' added later
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
 */
export const ProjectSchema = z.object({
  folders: z.record(z.string(), z.record(z.string(), z.string())),
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
  | 'offline' // network/git error; retries on the next poll (amber)
  | 'conflict' // merge conflict to resolve by hand (red, auto paused)

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
  /** last network/git error (null unless status is 'offline') */
  lastError: string | null
}
