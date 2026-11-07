import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import type { SyncEngineState } from '../../../core/types'
import { FRESH_MS, summarizeSync } from './syncSummary'

// Identity-ish t: returns the key, plus a count when given, so assertions read the intent.
const t = ((key: string, opts?: { count?: number }) =>
  opts?.count !== undefined ? `${key}:${opts.count}` : key) as unknown as TFunction

const NOW = 10_000_000

function engine(over: Partial<SyncEngineState> = {}): SyncEngineState {
  return {
    status: 'idle',
    auto: true,
    intervalMs: 120_000,
    lastSyncedAt: NOW - 30_000,
    pending: { up: 0, down: 0, checkedAt: NOW },
    conflicts: [],
    lastError: null,
    errorKind: null,
    blockedBy: null,
    removedFromRepo: false,
    ...over,
  }
}

describe('summarizeSync (#139)', () => {
  it('auto off + edits waiting never says "Up to date": counts them, warns, offers auto', () => {
    const s = summarizeSync(
      engine({ auto: false, pending: { up: 12, down: 0, checkedAt: NOW } }),
      0,
      NOW,
      t,
    )
    expect(s.label).toBe('home.status.pending:12')
    expect(s.tone).toBe('warn')
    expect(s.offerAutoOn).toBe(true)
    expect(s.meta).toContain('home.meta.autoOffWaiting')
  })

  it('auto on + edits waiting: says they move shortly, no warning', () => {
    const s = summarizeSync(engine({ pending: { up: 2, down: 0, checkedAt: NOW } }), 0, NOW, t)
    expect(s.label).toBe('home.status.pending:2')
    expect(s.tone).toBe('ok')
    expect(s.offerAutoOn).toBe(false)
  })

  it('only remote changes waiting: counts them as coming in', () => {
    const s = summarizeSync(
      engine({ auto: false, pending: { up: 0, down: 3, checkedAt: NOW } }),
      0,
      NOW,
      t,
    )
    expect(s.label).toBe('home.status.toDownload:3')
    expect(s.offerAutoOn).toBe(true)
  })

  it('auto off, nothing waiting, last sync long ago: "No local changes", not "Up to date"', () => {
    const s = summarizeSync(engine({ auto: false, lastSyncedAt: NOW - FRESH_MS - 1 }), 0, NOW, t)
    expect(s.label).toBe('home.status.noLocalChanges')
    expect(s.meta).toContain('home.meta.lastChecked')
    expect(s.tone).toBe('muted')
  })

  it('auto off, nothing waiting, right after a sync: "Up to date" is true', () => {
    const s = summarizeSync(engine({ auto: false, lastSyncedAt: NOW - 1_000 }), 0, NOW, t)
    expect(s.label).toBe('home.status.upToDate')
  })

  it('auto off and never synced: says so', () => {
    const s = summarizeSync(engine({ auto: false, lastSyncedAt: null }), 0, NOW, t)
    expect(s.label).toBe('home.status.noLocalChanges')
    expect(s.meta).toContain('home.meta.neverChecked')
  })

  it('auto off before the first count: "Checking…", never "Up to date"', () => {
    const s = summarizeSync(engine({ auto: false, pending: null }), 0, NOW, t)
    expect(s.label).toBe('home.status.checking')
  })

  it('auto on, nothing waiting: "Up to date"', () => {
    const s = summarizeSync(engine(), 0, NOW, t)
    expect(s.label).toBe('home.status.upToDate')
    expect(s.tone).toBe('ok')
  })

  it('conflict, blocked, syncing, offline and error win over pending counts', () => {
    const p = { pending: { up: 5, down: 0, checkedAt: NOW } }
    expect(summarizeSync(engine(p), 2, NOW, t).label).toBe('home.status.conflict')
    expect(
      summarizeSync(engine({ ...p, blockedBy: { kind: 'cli', pid: 1 } }), 0, NOW, t).meta,
    ).toBe('home.meta.blockedCli')
    expect(summarizeSync(engine({ ...p, status: 'syncing' }), 0, NOW, t).label).toBe(
      'home.status.syncing',
    )
    expect(summarizeSync(engine({ ...p, status: 'offline' }), 0, NOW, t).tone).toBe('warn')
    const err = summarizeSync(engine({ ...p, status: 'error', errorKind: 'access' }), 0, NOW, t)
    expect(err.label).toBe('home.status.noAccess')
    expect(summarizeSync(null, 0, NOW, t).label).toBe('home.status.loading')
  })
})
