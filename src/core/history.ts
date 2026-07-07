import type { HistoryType } from './types'

// Every message the app writes is prefixed with this; anything else (git merge
// commits, external commits) is filtered out of the activity view.
const PREFIX = 'Claude Total Recall: '

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
  if (!subject.startsWith(PREFIX)) return null // merge / external commit
  const body = subject.slice(PREFIX.length).trim()
  if (body === 'initial structure') return null // onboarding seed → noise

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
  if (body === 'resolve conflicts') return { type: 'conflicts' }
  // `set a/b on x` (current) or legacy `a/b on x` — kept last so the keyword forms win.
  if ((m = /^(?:set )?(.+)\/(.+) on (.+)$/.exec(body)))
    return { type: 'set-folder', project: m[1], slot: m[2], machineId: m[3] }
  return { type: 'other' }
}
