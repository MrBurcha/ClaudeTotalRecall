import { describe, expect, it } from 'vitest'
import { runPreflight, type PreflightDeps } from './preflight'
import type { ExecResult } from './exec'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr = 'error'): ExecResult => ({ code: 1, stdout: '', stderr })

describe('runPreflight', () => {
  it('todo OK cuando git, gh y gh-auth están presentes', async () => {
    const deps: PreflightDeps = {
      find: (n) => (n === 'git' ? '/usr/bin/git' : '/opt/homebrew/bin/gh'),
      exec: async () => ok('Logged in'),
    }
    const res = await runPreflight(deps)
    expect(res.ok).toBe(true)
    expect(res.checks.map((c) => c.name)).toEqual(['git', 'gh', 'gh-auth'])
    expect(res.checks.every((c) => c.ok)).toBe(true)
  })

  it('falla y guía cuando git no está', async () => {
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

  it('falla cuando gh no está autenticado', async () => {
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

  it('no intenta verificar auth si gh no está instalado', async () => {
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
