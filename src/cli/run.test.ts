import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../platform', () => ({ createPlatformAdapter: () => ({}) }))
vi.mock('../core/preflight', () => ({ runPreflight: vi.fn() }))
vi.mock('../core/service', () => ({
  buildVerbPlan: vi.fn(),
  connectRepo: vi.fn(),
  pullRepo: vi.fn(),
  registerMachine: vi.fn(),
  repoStatus: vi.fn(),
  syncOutgoing: vi.fn(),
  syncIncoming: vi.fn(),
}))

import { flagValue, hasFlag, main } from './run'
import { runPreflight } from '../core/preflight'
import { buildVerbPlan, connectRepo, pullRepo, syncOutgoing } from '../core/service'

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
    expect(output).toContain('claude-total-recall <command>')
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
