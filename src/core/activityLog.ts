import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ActivityLogSchema, type ActivityLog, type IncomingRecord } from './types'
import type { PlatformAdapter } from '../platform'

/**
 * Local, per-machine ledger of incoming syncs. Incoming (pull → apply) never
 * commits or touches the remote, so its trace can't come from git — we record it
 * here, in `~/.config/claudetr/activity.local.json` (outside the repo working
 * copy → inherently never synced), and history() merges it with the git log.
 *
 * The whole thing is best-effort: a missing or corrupt file reads as empty, and
 * writing is wrapped in try/catch by callers so a ledger hiccup never breaks a
 * sync (the machine's files are already applied by the time we record).
 */

/** Cap on stored incoming records (the merge with the git log is limit-bounded anyway). */
const CAP = 200

export function activityLogPath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'activity.local.json')
}

function emptyLog(): ActivityLog {
  return { version: 1, incoming: [] }
}

async function readJson(path: string): Promise<unknown | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return JSON.parse(raw)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Missing OR corrupt file ⇒ the empty log (a fresh object, safe to mutate). */
export async function loadActivityLog(adapter: PlatformAdapter): Promise<ActivityLog> {
  try {
    const data = await readJson(activityLogPath(adapter))
    if (data === null) return emptyLog()
    return ActivityLogSchema.parse(data)
  } catch {
    return emptyLog()
  }
}

export async function saveActivityLog(adapter: PlatformAdapter, log: ActivityLog): Promise<void> {
  // Keep only the newest CAP records (append order is chronological, newest last).
  await writeJson(activityLogPath(adapter), { ...log, incoming: log.incoming.slice(-CAP) })
}

/** Appends one incoming record and advances `lastHead` (the anchor for `from` attribution). */
export async function recordIncoming(
  adapter: PlatformAdapter,
  record: IncomingRecord,
  head: string | null,
): Promise<void> {
  const log = await loadActivityLog(adapter)
  log.incoming.push(record)
  if (head) log.lastHead = head
  await saveActivityLog(adapter, log)
}

/**
 * Seeds `lastHead` without adding a record, so the FIRST incoming after
 * registration can already attribute its source (called from registerMachine).
 */
export async function seedActivityHead(
  adapter: PlatformAdapter,
  head: string | null,
): Promise<void> {
  if (!head) return
  const log = await loadActivityLog(adapter)
  log.lastHead = head
  await saveActivityLog(adapter, log)
}
