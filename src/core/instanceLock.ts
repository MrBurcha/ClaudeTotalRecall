import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlatformAdapter } from '../platform'

// ─────────────────────────────────────────────────────────────────────────────
// Cross-process "one syncer per machine" lock (#141).
//
// `withRepoLock` (repoLock.ts) serializes git work inside ONE process, and the
// Electron single-instance lock (#140) keeps the app to one copy per app name.
// Neither stops the CLI, or a second app build with a different name (a dev build,
// or the app before/after a rename), from mutating the same working copy and local
// state at the same time. This lock file in the local config dir does: whoever
// syncs this machine holds it for as long as it may mutate.
//
// - Acquire = atomic exclusive create (`open(…, 'wx')`).
// - Stale = the holder's pid is dead, or its heartbeat is older than STALE_MS (a
//   crash followed by pid reuse, common on Windows), or the file is unreadable and
//   not brand new. A stale lock is taken over.
// - The holder refreshes `heartbeatAt` every HEARTBEAT_MS and removes the file on
//   exit (only if it still carries its own token).
// ─────────────────────────────────────────────────────────────────────────────

export type LockKind = 'app' | 'cli'

export interface LockHolder {
  pid: number
  kind: LockKind
  /** epoch ms */
  startedAt: number
  /** epoch ms of the last heartbeat */
  heartbeatAt: number
  /** random per-acquisition id: tells our lock apart from a successor's */
  token: string
}

export const LOCK_FILE = 'instance.lock'
export const HEARTBEAT_MS = 30_000
export const STALE_MS = 120_000
/** Between `open('wx')` and the first write a lock is briefly empty: don't call it stale. */
const FRESH_GRACE_MS = 10_000

export interface LockDeps {
  pid: number
  now: () => number
  isAlive: (pid: number) => boolean
}

/** `kill(pid, 0)` probes without signalling; EPERM means it exists but isn't ours. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const defaultDeps: LockDeps = { pid: process.pid, now: () => Date.now(), isAlive: processIsAlive }

export function instanceLockPath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), LOCK_FILE)
}

function parseHolder(raw: string): LockHolder | null {
  try {
    const v = JSON.parse(raw) as Partial<LockHolder>
    if (
      typeof v.pid === 'number' &&
      (v.kind === 'app' || v.kind === 'cli') &&
      typeof v.startedAt === 'number' &&
      typeof v.heartbeatAt === 'number' &&
      typeof v.token === 'string'
    ) {
      return v as LockHolder
    }
    return null
  } catch {
    return null
  }
}

interface LockFileState {
  /** null when the file exists but can't be parsed */
  holder: LockHolder | null
  mtimeMs: number
}

/** The lock file's current contents, or null when there is no lock file. */
async function readLockFile(path: string): Promise<LockFileState | null> {
  try {
    const [raw, st] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return { holder: parseHolder(raw), mtimeMs: st.mtimeMs }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** Who holds this machine's lock right now (live or not), or null if nobody. */
export async function readInstanceLock(adapter: PlatformAdapter): Promise<LockHolder | null> {
  return (await readLockFile(instanceLockPath(adapter)))?.holder ?? null
}

/** True when a lock can be taken over: dead pid, missed heartbeats, or a corrupt old file. */
export function isStale(state: LockFileState, deps: LockDeps, staleMs = STALE_MS): boolean {
  const now = deps.now()
  const h = state.holder
  if (!h) return now - state.mtimeMs > FRESH_GRACE_MS
  // Our own pid with a token we don't hold: a leftover from this very process.
  if (h.pid === deps.pid) return true
  if (!deps.isAlive(h.pid)) return true
  return now - h.heartbeatAt > staleMs
}

export type AcquireResult =
  { acquired: true; lock: InstanceLock } | { acquired: false; holder: LockHolder | null }

function isExistsError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code
  // Windows reports EPERM while a just-deleted file is still pending removal.
  return code === 'EEXIST' || code === 'EPERM'
}

/**
 * Tries to take this machine's sync lock. Never waits: on contention it returns the
 * live holder so the caller decides (the CLI refuses; the app retries).
 */
export async function acquireInstanceLock(
  adapter: PlatformAdapter,
  kind: LockKind,
  deps: LockDeps = defaultDeps,
): Promise<AcquireResult> {
  const path = instanceLockPath(adapter)
  await mkdir(adapter.configHome(), { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = deps.now()
    const holder: LockHolder = {
      pid: deps.pid,
      kind,
      startedAt: now,
      heartbeatAt: now,
      token: randomUUID(),
    }
    try {
      const fh = await open(path, 'wx')
      try {
        await fh.writeFile(JSON.stringify(holder))
      } finally {
        await fh.close()
      }
      return { acquired: true, lock: new InstanceLock(path, holder, deps) }
    } catch (e) {
      if (!isExistsError(e)) throw e
    }
    const current = await readLockFile(path)
    if (!current) continue // released between our create and our read: try again
    if (!isStale(current, deps)) return { acquired: false, holder: current.holder }
    await rm(path, { force: true })
  }
  return { acquired: false, holder: (await readLockFile(path))?.holder ?? null }
}

/** A held lock. Keep it alive with `startHeartbeat`, give it back with `release`. */
export class InstanceLock {
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly path: string,
    private holder: LockHolder,
    private readonly deps: LockDeps,
  ) {}

  get token(): string {
    return this.holder.token
  }

  /** Is the file still ours? False once someone took it over (e.g. after a long sleep). */
  async isHeld(): Promise<boolean> {
    const cur = await readLockFile(this.path).catch(() => null)
    return cur?.holder?.token === this.holder.token
  }

  /** Refreshes the heartbeat. Returns false (and writes nothing) if the lock was lost. */
  async heartbeat(): Promise<boolean> {
    if (!(await this.isHeld())) return false
    this.holder = { ...this.holder, heartbeatAt: this.deps.now() }
    await writeFile(this.path, JSON.stringify(this.holder))
    return true
  }

  /** Heartbeats on an interval (unref'd); `onLost` fires once if the lock is taken away. */
  startHeartbeat(onLost?: () => void, intervalMs = HEARTBEAT_MS): void {
    this.stopHeartbeat()
    this.timer = setInterval(() => {
      this.heartbeat().then(
        (ok) => {
          if (!ok) {
            this.stopHeartbeat()
            onLost?.()
          }
        },
        () => {
          /* transient fs error: the next beat retries */
        },
      )
    }, intervalMs)
    this.timer.unref?.()
  }

  stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Removes the lock file if it's still ours. Safe to call twice. */
  async release(): Promise<void> {
    this.stopHeartbeat()
    if (await this.isHeld()) await rm(this.path, { force: true })
  }

  /** Synchronous variant for exit handlers, where async work never completes. */
  releaseSync(): void {
    this.stopHeartbeat()
    try {
      const h = parseHolder(readFileSync(this.path, 'utf8'))
      if (h?.token === this.holder.token) rmSync(this.path, { force: true })
    } catch {
      /* already gone */
    }
  }
}
