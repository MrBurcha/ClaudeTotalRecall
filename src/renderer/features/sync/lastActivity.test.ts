import { describe, expect, it } from 'vitest'
import type { FileChange, HistoryEntry, HistoryType } from '../../../core/types'
import { summarizeLastActivity } from './lastActivity'

function entry(
  type: HistoryType,
  at: string,
  changes: FileChange['path'][],
  hash = at,
): HistoryEntry {
  const c = changes.map((path) => ({ status: 'modified' as const, path }))
  return { hash, at, type, files: c.length, changes: c }
}

describe('summarizeLastActivity', () => {
  it('returns null with no entries', () => {
    expect(summarizeLastActivity([])).toBeNull()
  })

  it('ignores admin-only entries (no real file movement)', () => {
    const entries = [
      entry('register', '2026-07-08T10:00:00Z', []),
      entry('new-project', '2026-07-08T09:00:00Z', []),
    ]
    expect(summarizeLastActivity(entries)).toBeNull()
  })

  it('skips entries whose only changes are structural .gitkeep noise', () => {
    const entries = [
      entry('outgoing', '2026-07-08T10:00:00Z', ['memories/projects/app/memory/.gitkeep']),
      entry('outgoing', '2026-07-08T09:00:00Z', ['memories/projects/app/memory/notes.md']),
    ]
    const s = summarizeLastActivity(entries)
    expect(s).not.toBeNull()
    expect(s?.at).toBe('2026-07-08T09:00:00Z')
    expect(s?.fileCount).toBe(1)
  })

  it('picks the newest real entry (list is newest-first) and counts visible files', () => {
    const entries = [
      entry('outgoing', '2026-07-08T12:00:00Z', [
        'memories/projects/app/memory/a.md',
        'memories/projects/app/memory/b.md',
        'memories/projects/app/memory/.gitkeep',
      ]),
      entry('incoming', '2026-07-08T08:00:00Z', ['memories/user/CLAUDE.md']),
    ]
    const s = summarizeLastActivity(entries)
    expect(s?.at).toBe('2026-07-08T12:00:00Z')
    expect(s?.fileCount).toBe(2)
    expect(s?.location).toEqual({ kind: 'project', name: 'app' })
  })

  it('labels a single user-level bucket', () => {
    const s = summarizeLastActivity([
      entry('outgoing', '2026-07-08T10:00:00Z', ['memories/user/commands/deploy.md']),
    ])
    expect(s?.location).toEqual({ kind: 'user' })
  })

  it('labels a single pinned bucket', () => {
    const s = summarizeLastActivity([
      entry('outgoing', '2026-07-08T10:00:00Z', ['memories/pinned/prod-env']),
    ])
    expect(s?.location).toEqual({ kind: 'pinned' })
  })

  it('is mixed when changes span two projects', () => {
    const s = summarizeLastActivity([
      entry('outgoing', '2026-07-08T10:00:00Z', [
        'memories/projects/app/memory/a.md',
        'memories/projects/api/memory/b.md',
      ]),
    ])
    expect(s?.location).toEqual({ kind: 'mixed' })
  })

  it('is mixed when changes span different buckets', () => {
    const s = summarizeLastActivity([
      entry('incoming', '2026-07-08T10:00:00Z', [
        'memories/user/CLAUDE.md',
        'memories/pinned/prod-env',
      ]),
    ])
    expect(s?.location).toEqual({ kind: 'mixed' })
  })
})
