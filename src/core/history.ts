import type { HistoryType } from './types'

// Every message the app writes is prefixed with COMMIT_PREFIX; anything else (git
// merge commits, external commits) is filtered out of the activity view. Commits
// written before the Engram rename (#123) — and by machines still on an older
// version during the switch — carry LEGACY_COMMIT_PREFIX and classify the same way.
export const COMMIT_PREFIX = 'Engram: '
export const LEGACY_COMMIT_PREFIX = 'Claude Total Recall: '

function stripPrefix(subject: string): string | null {
  if (subject.startsWith(COMMIT_PREFIX)) return subject.slice(COMMIT_PREFIX.length)
  if (subject.startsWith(LEGACY_COMMIT_PREFIX)) return subject.slice(LEGACY_COMMIT_PREFIX.length)
  return null
}

export interface ClassifiedCommit {
  type: HistoryType
  machineId?: string
  project?: string
  slot?: string
  from?: string
  to?: string
  pin?: string
}

/**
 * Maps a commit subject to a typed activity entry, or null if it should be hidden
 * (merges, the initial-structure seed, external commits). Recognizes both the
 * current message format and the legacy `gather` / `<proj>/<slot> on <id>` forms,
 * so the real repo's pre-rename history classifies correctly.
 *
 * Order matters: keyword-prefixed messages (remove/pin/…) are matched before the
 * generic `[set ]<proj>/<slot> on <id>` catch, which would otherwise swallow them.
 */
export function classifyCommit(subject: string): ClassifiedCommit | null {
  // Notebook (#104) commits carry their own `notebook: <verb> <path>` subject (kept
  // out of the app prefix so git log stays readable). Surface them in the ledger; the
  // changed files come from the commit's name-status, so no fields are needed here.
  if (/^notebook: /.test(subject)) return { type: 'notebook' }
  const stripped = stripPrefix(subject)
  if (stripped === null) return null // merge / external commit
  const body = stripped.trim()
  if (body === 'initial structure') return null // onboarding seed → noise
  // Automatic shared-config rename bookkeeping (markers, the rename itself): not activity.
  if (body.startsWith('fleet: ')) return null

  let m: RegExpExecArray | null
  if ((m = /^outgoing on (.+)$/.exec(body))) return { type: 'outgoing', machineId: m[1] }
  if (body === 'gather') return { type: 'outgoing' } // legacy (pre-rename), no machine
  if ((m = /^register machine (.+)$/.exec(body))) return { type: 'register', machineId: m[1] }
  if ((m = /^new project (.+)$/.exec(body))) return { type: 'new-project', project: m[1] }
  if ((m = /^delete project (.+)$/.exec(body))) return { type: 'delete-project', project: m[1] }
  if ((m = /^rename project (.+) -> (.+)$/.exec(body)))
    return { type: 'rename-project', from: m[1], to: m[2] }
  if ((m = /^remove (.+)\/(.+) on (.+)$/.exec(body)))
    return { type: 'remove-folder', project: m[1], slot: m[2], machineId: m[3] }
  if ((m = /^pin (.+) on (.+)$/.exec(body))) return { type: 'pin', pin: m[1], machineId: m[2] }
  if ((m = /^unpin (.+)$/.exec(body))) return { type: 'unpin', pin: m[1] }
  if ((m = /^remove machine (.+)$/.exec(body))) return { type: 'other', machineId: m[1] }
  if (body === 'resolve conflicts') return { type: 'conflicts' }
  if (body === 'remove Claude Code managed cache') return { type: 'cleanup' } // #135
  // `set a/b on x` (current) or legacy `a/b on x` — kept last so the keyword forms win.
  if ((m = /^(?:set )?(.+)\/(.+) on (.+)$/.exec(body)))
    return { type: 'set-folder', project: m[1], slot: m[2], machineId: m[3] }
  return { type: 'other' }
}
