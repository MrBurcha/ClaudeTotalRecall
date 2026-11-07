import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ createPlatformAdapter: () => ({}) }))
vi.mock('../core/preflight', () => ({ runPreflight: vi.fn() }))
vi.mock('../core/configHomeMigration', () => ({ migrateConfigHome: vi.fn(async () => 'noop') }))
const lockHandle = { startHeartbeat: vi.fn(), release: vi.fn(async () => {}), releaseSync: vi.fn() }
vi.mock('../core/instanceLock', () => ({
  acquireInstanceLock: vi.fn(async () => ({ acquired: true, lock: lockHandle })),
}))
vi.mock('../core/service', () => ({
  buildVerbPlan: vi.fn(),
  connectRepo: vi.fn(),
  migrateSharedConfig: vi.fn(),
  pullRepo: vi.fn(),
  registerMachine: vi.fn(),
  repoStatus: vi.fn(),
  syncOutgoing: vi.fn(),
  syncIncoming: vi.fn(),
}))

import { flagValue, hasFlag, lockedMessage, main } from './run'
import { migrateConfigHome } from '../core/configHomeMigration'
import { acquireInstanceLock } from '../core/instanceLock'
import { runPreflight } from '../core/preflight'
import {
  buildVerbPlan,
  connectRepo,
  migrateSharedConfig,
  pullRepo,
  syncOutgoing,
} from '../core/service'

let output = ''
beforeEach(() => {
  output = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    output += typeof chunk === 'string' ? chunk : chunk.toString()
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('CLI arg helpers', () => {
  it('hasFlag detects a flag', () => {
    expect(hasFlag(['x', '--yes'], '--yes')).toBe(true)
    expect(hasFlag(['x'], '--yes')).toBe(false)
  })
  it('flagValue reads the token after the flag', () => {
    expect(flagValue(['--name', 'box'], '--name')).toBe('box')
    expect(flagValue(['--name'], '--name')).toBeUndefined()
    expect(flagValue([], '--name')).toBeUndefined()
  })
})

describe('CLI dispatch', () => {
  it('prints usage and exits 0 for help / no args', async () => {
    expect(await main([])).toBe(0)
    expect(await main(['help'])).toBe(0)
    expect(output).toContain('engram <command>')
  })

  it('exits 1 on an unknown command', async () => {
    expect(await main(['frobnicate'])).toBe(1)
    expect(output).toContain('Unknown command: frobnicate')
  })

  it('connect without a remote exits 1 and never touches git', async () => {
    expect(await main(['connect'])).toBe(1)
    expect(output).toContain('Missing remote')
    expect(vi.mocked(connectRepo)).not.toHaveBeenCalled()
  })

  it('check maps preflight ok → 0 and failure → 1', async () => {
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: true, checks: [] } as any)
    expect(await main(['check'])).toBe(0)

    vi.mocked(runPreflight).mockResolvedValueOnce({
      ok: false,
      checks: [{ name: 'gh-auth', ok: false, fix: 'Run: gh auth login' }],
    } as any)
    expect(await main(['check'])).toBe(1)
    expect(output).toContain('Preflight has problems')
  })
})

describe('CLI sync (outgoing / incoming)', () => {
  const mutatingPlan = {
    verb: 'outgoing',
    actions: [{ type: 'create', logicalPath: 'memories/user/CLAUDE.md' }],
  }

  it('--dry-run previews and never mutates', async () => {
    vi.mocked(buildVerbPlan).mockResolvedValueOnce(mutatingPlan as any)
    expect(await main(['outgoing', '--dry-run'])).toBe(0)
    expect(output).toContain('(dry-run: nothing was touched)')
    expect(vi.mocked(syncOutgoing)).not.toHaveBeenCalled()
  })

  it('a mutating plan without --yes is cancelled on a non-TTY → exit 1', async () => {
    vi.mocked(buildVerbPlan).mockResolvedValueOnce(mutatingPlan as any)
    expect(await main(['outgoing'])).toBe(1)
    expect(output).toContain('Cancelled')
    expect(vi.mocked(syncOutgoing)).not.toHaveBeenCalled()
  })

  it('--yes runs the plan and reports the applied counts', async () => {
    vi.mocked(buildVerbPlan).mockResolvedValueOnce(mutatingPlan as any)
    vi.mocked(syncOutgoing).mockResolvedValueOnce({
      exec: { applied: 1, created: 1, overwritten: 0, deleted: 0 },
      conflicts: [],
      pushed: true,
      committed: true,
    } as any)
    expect(await main(['outgoing', '--yes'])).toBe(0)
    expect(vi.mocked(syncOutgoing)).toHaveBeenCalledOnce()
    expect(output).toContain('Applied: 1')
    expect(output).toContain('Pushed to the remote')
  })

  it('incoming aborts (exit 1) when the pre-pull hits conflicts', async () => {
    vi.mocked(pullRepo).mockResolvedValueOnce({
      ok: false,
      conflicts: ['memories/user/CLAUDE.md'],
    } as any)
    expect(await main(['incoming'])).toBe(1)
    expect(output).toContain('Conflicts while pulling')
    expect(vi.mocked(buildVerbPlan)).not.toHaveBeenCalled()
  })
})

describe('CLI machine lock (#141)', () => {
  const mutatingPlan = {
    verb: 'outgoing',
    actions: [{ type: 'create', logicalPath: 'memories/user/CLAUDE.md' }],
  }

  it('refuses a mutating command while the app holds the lock, touching nothing', async () => {
    vi.mocked(acquireInstanceLock).mockResolvedValueOnce({
      acquired: false,
      holder: { pid: 4242, kind: 'app', startedAt: 0, heartbeatAt: 0, token: 'x' },
    })
    expect(await main(['outgoing', '--yes'])).toBe(1)
    expect(output).toContain('The app is open on this machine')
    expect(output).toContain('pid 4242')
    expect(vi.mocked(buildVerbPlan)).not.toHaveBeenCalled()
    expect(vi.mocked(syncOutgoing)).not.toHaveBeenCalled()
  })

  it('releases the lock after a successful command', async () => {
    vi.mocked(buildVerbPlan).mockResolvedValueOnce(mutatingPlan as any)
    vi.mocked(syncOutgoing).mockResolvedValueOnce({
      exec: { applied: 1, created: 1, overwritten: 0, deleted: 0 },
      conflicts: [],
      pushed: true,
      committed: true,
    } as any)
    expect(await main(['outgoing', '--yes'])).toBe(0)
    expect(lockHandle.startHeartbeat).toHaveBeenCalled()
    expect(lockHandle.release).toHaveBeenCalled()
  })

  it('releases the lock even when the command throws', async () => {
    vi.mocked(buildVerbPlan).mockRejectedValueOnce(new Error('boom'))
    await expect(main(['outgoing', '--yes'])).rejects.toThrow('boom')
    expect(lockHandle.release).toHaveBeenCalled()
  })

  it('a --dry-run never takes the lock (it works while the app is open)', async () => {
    vi.mocked(buildVerbPlan).mockResolvedValueOnce(mutatingPlan as any)
    expect(await main(['incoming', '--dry-run'])).toBe(0)
    expect(vi.mocked(acquireInstanceLock)).not.toHaveBeenCalled()
  })

  it('explains another running command differently from the app', () => {
    expect(
      lockedMessage({ pid: 7, kind: 'cli', startedAt: 0, heartbeatAt: 0, token: 'y' }),
    ).toContain('Another engram command')
    expect(lockedMessage(null)).toContain('The app is open')
  })
})

describe('Engram rename (#123)', () => {
  it('moves ~/.config/claudetr before running any verb, and says so', async () => {
    vi.mocked(migrateConfigHome).mockResolvedValueOnce('migrated')
    vi.mocked(runPreflight).mockResolvedValueOnce({ ok: true, checks: [] } as any)
    expect(await main(['check'])).toBe(0)
    expect(vi.mocked(migrateConfigHome)).toHaveBeenCalledOnce()
    expect(output).toContain('Moved local data')
  })

  it('never touches local state just to print help', async () => {
    expect(await main(['help'])).toBe(0)
    expect(vi.mocked(migrateConfigHome)).not.toHaveBeenCalled()
  })

  it('a failed local-dir migration aborts the command', async () => {
    vi.mocked(migrateConfigHome).mockRejectedValueOnce(new Error('EBUSY'))
    await expect(main(['outgoing', '--yes'])).rejects.toThrow('EBUSY')
    expect(vi.mocked(buildVerbPlan)).not.toHaveBeenCalled()
  })

  it('migrate-config runs the shared rename under the machine lock', async () => {
    vi.mocked(migrateSharedConfig).mockResolvedValueOnce({ migrated: true })
    expect(await main(['migrate-config'])).toBe(0)
    expect(output).toContain('renamed to engram.json')
    expect(lockHandle.release).toHaveBeenCalled()
    vi.mocked(migrateSharedConfig).mockResolvedValueOnce({ migrated: false })
    expect(await main(['migrate-config'])).toBe(0)
    expect(output).toContain('already engram.json')
  })
})
