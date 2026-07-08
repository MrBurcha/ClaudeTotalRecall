import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import {
  activityLogPath,
  loadActivityLog,
  recordIncoming,
  saveActivityLog,
  seedActivityHead,
} from './activityLog'
import type { IncomingRecord } from './types'

let tmpHome: string
let adapter: PlatformAdapter

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'claude-total-recall-activity-'))
  adapter = createPlatformAdapter(process.platform, tmpHome)
})

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true })
})

function record(id: string): IncomingRecord {
  return {
    id,
    at: `2026-07-0${id}T00:00:00.000Z`,
    fromMachines: ['macbook'],
    changes: [{ status: 'modified', path: 'memories/user/CLAUDE.md' }],
  }
}

describe('activityLogPath', () => {
  it('is <configHome>/activity.local.json', () => {
    expect(activityLogPath(adapter)).toBe(join(adapter.configHome(), 'activity.local.json'))
  })
})

describe('loadActivityLog', () => {
  it('returns the empty log when the file is missing', async () => {
    expect(await loadActivityLog(adapter)).toEqual({ version: 1, incoming: [] })
  })

  it('returns a fresh (mutable) object each call — no shared empty state', async () => {
    const a = await loadActivityLog(adapter)
    a.incoming.push(record('1'))
    const b = await loadActivityLog(adapter)
    expect(b.incoming).toEqual([]) // the previous mutation didn't leak
  })

  it('falls back to the empty log on a corrupt file (no throw)', async () => {
    await mkdir(adapter.configHome(), { recursive: true })
    await writeFile(activityLogPath(adapter), 'not json {', 'utf8')
    expect(await loadActivityLog(adapter)).toEqual({ version: 1, incoming: [] })
  })

  it('falls back to the empty log on a schema-invalid file', async () => {
    await mkdir(adapter.configHome(), { recursive: true })
    await writeFile(activityLogPath(adapter), JSON.stringify({ version: 1, incoming: [{ bad: 1 }] }))
    expect(await loadActivityLog(adapter)).toEqual({ version: 1, incoming: [] })
  })
})

describe('recordIncoming', () => {
  it('appends a record and advances lastHead', async () => {
    await recordIncoming(adapter, record('1'), 'headA')
    const log = await loadActivityLog(adapter)
    expect(log.incoming).toHaveLength(1)
    expect(log.incoming[0].id).toBe('1')
    expect(log.lastHead).toBe('headA')
  })

  it('accumulates across calls', async () => {
    await recordIncoming(adapter, record('1'), 'headA')
    await recordIncoming(adapter, record('2'), 'headB')
    const log = await loadActivityLog(adapter)
    expect(log.incoming.map((r) => r.id)).toEqual(['1', '2'])
    expect(log.lastHead).toBe('headB')
  })

  it('keeps lastHead when passed null', async () => {
    await recordIncoming(adapter, record('1'), 'headA')
    await recordIncoming(adapter, record('2'), null)
    expect((await loadActivityLog(adapter)).lastHead).toBe('headA')
  })
})

describe('saveActivityLog CAP', () => {
  it('truncates to the newest 200 records', async () => {
    const many = Array.from({ length: 205 }, (_, i) => record(String(i)))
    await saveActivityLog(adapter, { version: 1, incoming: many })
    const log = await loadActivityLog(adapter)
    expect(log.incoming).toHaveLength(200)
    // newest kept: the last one written survives, the first 5 are dropped
    expect(log.incoming[log.incoming.length - 1].id).toBe('204')
    expect(log.incoming[0].id).toBe('5')
  })
})

describe('seedActivityHead', () => {
  it('sets lastHead without adding a record', async () => {
    await seedActivityHead(adapter, 'seededHead')
    const log = await loadActivityLog(adapter)
    expect(log.lastHead).toBe('seededHead')
    expect(log.incoming).toEqual([])
  })

  it('is a no-op for a null head', async () => {
    await seedActivityHead(adapter, null)
    // nothing written → still the empty log
    await expect(readFile(activityLogPath(adapter), 'utf8')).rejects.toThrow()
  })
})
