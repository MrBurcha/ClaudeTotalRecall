import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import {
  HEARTBEAT_MS,
  STALE_MS,
  acquireInstanceLock,
  instanceLockPath,
  isStale,
  processIsAlive,
  readInstanceLock,
  type LockDeps,
  type LockHolder,
} from './instanceLock'

let tmpHome: string
let adapter: PlatformAdapter
let clock: number
const alive = new Set<number>()

function deps(pid: number): LockDeps {
  return { pid, now: () => clock, isAlive: (p) => alive.has(p) }
}

function holder(over: Partial<LockHolder> = {}): LockHolder {
  return { pid: 111, kind: 'app', startedAt: clock, heartbeatAt: clock, token: 't-1', ...over }
}

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'engram-lock-'))
  adapter = createPlatformAdapter(process.platform, tmpHome)
  await mkdir(adapter.configHome(), { recursive: true })
  clock = 1_000_000
  alive.clear()
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(tmpHome, { recursive: true, force: true })
})

describe('acquireInstanceLock', () => {
  it('creates the lock (and the config dir) when nobody holds it', async () => {
    const r = await acquireInstanceLock(adapter, 'app', deps(10))
    expect(r.acquired).toBe(true)
    const h = await readInstanceLock(adapter)
    expect(h).toMatchObject({ pid: 10, kind: 'app', heartbeatAt: clock })
  })

  it('refuses while a live holder keeps its heartbeat, and reports who it is', async () => {
    alive.add(10)
    const first = await acquireInstanceLock(adapter, 'app', deps(10))
    expect(first.acquired).toBe(true)
    clock += STALE_MS - 1
    const second = await acquireInstanceLock(adapter, 'cli', deps(20))
    expect(second.acquired).toBe(false)
    if (!second.acquired) expect(second.holder).toMatchObject({ pid: 10, kind: 'app' })
  })

  it('takes over a lock whose process is gone (crash)', async () => {
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 111 })))
    const r = await acquireInstanceLock(adapter, 'app', deps(20))
    expect(r.acquired).toBe(true)
    expect(await readInstanceLock(adapter)).toMatchObject({ pid: 20 })
  })

  it('takes over a live pid whose heartbeat stopped (pid reuse after a crash)', async () => {
    alive.add(111)
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 111 })))
    clock += STALE_MS + 1
    const r = await acquireInstanceLock(adapter, 'cli', deps(20))
    expect(r.acquired).toBe(true)
  })

  it('treats an unreadable lock as held while fresh, stale once old', async () => {
    const path = instanceLockPath(adapter)
    await writeFile(path, '{"half": ')
    const now = Date.now()
    const fresh = await acquireInstanceLock(adapter, 'app', { ...deps(20), now: () => now })
    expect(fresh.acquired).toBe(false)
    if (!fresh.acquired) expect(fresh.holder).toBeNull()
    const old = new Date(now - 60_000)
    await utimes(path, old, old)
    const later = await acquireInstanceLock(adapter, 'app', { ...deps(20), now: () => now })
    expect(later.acquired).toBe(true)
  })

  it('takes over a leftover lock from its own pid', async () => {
    alive.add(20)
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 20, token: 'old' })))
    const r = await acquireInstanceLock(adapter, 'app', deps(20))
    expect(r.acquired).toBe(true)
  })
})

describe('InstanceLock', () => {
  it('release removes the file; a second release is a no-op', async () => {
    const r = await acquireInstanceLock(adapter, 'cli', deps(10))
    if (!r.acquired) throw new Error('expected the lock')
    await r.lock.release()
    expect(existsSync(instanceLockPath(adapter))).toBe(false)
    await r.lock.release()
  })

  it('never removes a successor’s lock', async () => {
    const r = await acquireInstanceLock(adapter, 'app', deps(10))
    if (!r.acquired) throw new Error('expected the lock')
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 30, token: 'next' })))
    await r.lock.release()
    r.lock.releaseSync()
    expect(await readInstanceLock(adapter)).toMatchObject({ token: 'next' })
  })

  it('releaseSync removes our own lock', async () => {
    const r = await acquireInstanceLock(adapter, 'app', deps(10))
    if (!r.acquired) throw new Error('expected the lock')
    r.lock.releaseSync()
    expect(existsSync(instanceLockPath(adapter))).toBe(false)
  })

  it('heartbeat refreshes heartbeatAt and reports a lost lock', async () => {
    const r = await acquireInstanceLock(adapter, 'app', deps(10))
    if (!r.acquired) throw new Error('expected the lock')
    clock += 5_000
    expect(await r.lock.heartbeat()).toBe(true)
    expect(await readInstanceLock(adapter)).toMatchObject({ heartbeatAt: clock })
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 30, token: 'next' })))
    expect(await r.lock.heartbeat()).toBe(false)
    expect(JSON.parse(await readFile(instanceLockPath(adapter), 'utf8'))).toMatchObject({
      token: 'next',
    })
  })

  it('startHeartbeat beats on an interval and calls onLost once when taken over', async () => {
    const r = await acquireInstanceLock(adapter, 'app', deps(10))
    if (!r.acquired) throw new Error('expected the lock')
    const lost = vi.fn()
    // Taken over BEFORE the first beat: a beat racing this write could legitimately
    // rewrite our token (a real takeover needs minutes without beats, so no race there).
    await writeFile(instanceLockPath(adapter), JSON.stringify(holder({ pid: 30, token: 'next' })))
    r.lock.startHeartbeat(lost, 20)
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 2_000 })
    r.lock.stopHeartbeat()
    expect(HEARTBEAT_MS).toBeLessThan(STALE_MS)
  })
})

describe('isStale / processIsAlive', () => {
  it('a live, beating holder is not stale', () => {
    alive.add(111)
    expect(isStale({ holder: holder(), mtimeMs: clock }, deps(20))).toBe(false)
  })

  it('this process is alive; an absurd pid is not', () => {
    expect(processIsAlive(process.pid)).toBe(true)
    expect(processIsAlive(2 ** 22 + 12345)).toBe(false)
  })
})
