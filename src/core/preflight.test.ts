import { describe, expect, it } from 'vitest'
import { runPreflight, type PreflightDeps } from './preflight'
import type { ExecResult } from './exec'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr = 'error'): ExecResult => ({ code: 1, stdout: '', stderr })

describe('runPreflight', () => {
  it('all OK when git, gh and gh-auth are present', async () => {
    const deps: PreflightDeps = {
      find: (n) => (n === 'git' ? '/usr/bin/git' : '/opt/homebrew/bin/gh'),
      exec: async () => ok('Logged in'),
    }
    const res = await runPreflight(deps)
    expect(res.ok).toBe(true)
    expect(res.checks.map((c) => c.name)).toEqual(['git', 'gh', 'gh-auth'])
    expect(res.checks.every((c) => c.ok)).toBe(true)
  })

  it('fails and guides when git is missing', async () => {
    const deps: PreflightDeps = {
      find: (n) => (n === 'git' ? null : '/opt/homebrew/bin/gh'),
      exec: async () => ok(),
    }
    const res = await runPreflight(deps)
    expect(res.ok).toBe(false)
    const git = res.checks.find((c) => c.name === 'git')!
    expect(git.ok).toBe(false)
    expect(git.fix).toBeTruthy()
  })

  it('fails when gh is not authenticated', async () => {
    const deps: PreflightDeps = {
      find: () => '/opt/homebrew/bin/gh',
      exec: async () => fail('not logged in'),
    }
    const res = await runPreflight(deps)
    expect(res.ok).toBe(false)
    const auth = res.checks.find((c) => c.name === 'gh-auth')!
    expect(auth.ok).toBe(false)
    expect(auth.fix).toContain('gh auth login')
  })

  it('does not try to verify auth if gh is not installed', async () => {
    let execCalled = false
    const deps: PreflightDeps = {
      find: () => null,
      exec: async () => {
        execCalled = true
        return ok()
      },
    }
    const res = await runPreflight(deps)
    expect(execCalled).toBe(false)
    expect(res.ok).toBe(false)
  })
})
