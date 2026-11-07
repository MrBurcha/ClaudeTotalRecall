import { describe, expect, it } from 'vitest'
import { runPreflight, type PreflightDeps } from './preflight'
import type { ExecResult } from './exec'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })
const fail = (stderr = 'error'): ExecResult => ({ code: 1, stdout: '', stderr })

/** Real stderr of /usr/bin/git started as x86_64 with Command Line Tools 27 (#133). */
const XCRUN_ERROR =
  'xcrun: error: unable to load libxcrun ' +
  '(dlopen(/Library/Developer/CommandLineTools/usr/lib/libxcrun.dylib, 0x0005): tried: ' +
  "'/Library/Developer/CommandLineTools/usr/lib/libxcrun.dylib' (fat file, but missing " +
  "compatible architecture (have 'arm64,arm64e', need 'x86_64')))."

/** Stub exec: `--version` answers per binary, `gh auth status` answers `auth`. */
function execStub(
  versions: Partial<Record<'git' | 'gh', ExecResult | Error>>,
  auth: ExecResult | Error = ok('Logged in'),
): { exec: PreflightDeps['exec']; calls: string[] } {
  const calls: string[] = []
  const exec: PreflightDeps['exec'] = async (bin, args) => {
    calls.push([bin, ...args].join(' '))
    const r = args[0] === 'auth' ? auth : versions[bin as 'git' | 'gh']
    if (r === undefined) throw new Error(`unexpected exec: ${bin} ${args.join(' ')}`)
    if (r instanceof Error) throw r
    return r
  }
  return { exec, calls }
}

const healthy = {
  git: ok('git version 2.54.0\n'),
  gh: ok('gh version 2.40.0 (2023-12-13)\nhttps://x'),
}
const findBoth = (n: string): string => (n === 'git' ? '/usr/bin/git' : '/opt/homebrew/bin/gh')

describe('runPreflight', () => {
  it('all OK when git and gh are present, start, and gh is authenticated', async () => {
    const { exec, calls } = execStub(healthy)
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.ok).toBe(true)
    expect(res.checks.map((c) => c.name)).toEqual(['git', 'gh', 'gh-auth'])
    expect(res.checks.every((c) => c.ok)).toBe(true)
    // It actually executes the binaries, not only locates them.
    expect(calls).toEqual(expect.arrayContaining(['git --version', 'gh --version']))
    expect(res.checks[0].detail).toBe('/usr/bin/git (git version 2.54.0)')
    expect(res.checks[1].detail).toBe('/opt/homebrew/bin/gh (gh version 2.40.0 (2023-12-13))')
  })

  it('falls back to the bare path when --version prints nothing', async () => {
    const { exec } = execStub({ git: ok(''), gh: ok('') })
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.checks[0].detail).toBe('/usr/bin/git')
  })

  it('fails and guides when git is missing', async () => {
    const { exec, calls } = execStub(healthy)
    const res = await runPreflight({
      find: (n) => (n === 'git' ? null : '/opt/homebrew/bin/gh'),
      exec,
    })
    expect(res.ok).toBe(false)
    const git = res.checks.find((c) => c.name === 'git')!
    expect(git.ok).toBe(false)
    expect(git.detailKey).toBe('git.missing')
    expect(git.fix).toBeTruthy()
    expect(calls).not.toContain('git --version')
  })

  it('fails with the real stderr when git is found but exits non-zero (#133)', async () => {
    const { exec } = execStub({ ...healthy, git: fail(`${XCRUN_ERROR}\n`) })
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.ok).toBe(false)
    const git = res.checks.find((c) => c.name === 'git')!
    expect(git.ok).toBe(false)
    expect(git.detailKey).toBe('git.cannotRun')
    expect(git.fixKey).toBe('git.fixCannotRun')
    expect(git.params).toEqual({ path: '/usr/bin/git', error: XCRUN_ERROR })
    expect(git.detail).toContain('unable to load libxcrun')
    expect(git.detail).toContain('/usr/bin/git')
    // gh is unaffected.
    expect(res.checks.find((c) => c.name === 'gh')!.ok).toBe(true)
  })

  it('reports the exit code when a failing binary prints nothing', async () => {
    const { exec } = execStub({ ...healthy, git: { code: 127, stdout: '', stderr: '' } })
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.checks[0].params?.error).toBe('exited with code 127')
  })

  it('fails with the spawn error when git is found but cannot start', async () => {
    const { exec } = execStub({ ...healthy, git: new Error('spawn /usr/bin/git EACCES') })
    const res = await runPreflight({ find: findBoth, exec })
    const git = res.checks.find((c) => c.name === 'git')!
    expect(git.ok).toBe(false)
    expect(git.detailKey).toBe('git.cannotRun')
    expect(git.params?.error).toBe('spawn /usr/bin/git EACCES')
  })

  it('fails gh and skips the auth probe when gh is found but cannot run', async () => {
    const { exec, calls } = execStub({ ...healthy, gh: fail('dyld: Library not loaded') })
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.ok).toBe(false)
    const gh = res.checks.find((c) => c.name === 'gh')!
    expect(gh.detailKey).toBe('gh.cannotRun')
    expect(gh.params?.error).toBe('dyld: Library not loaded')
    const auth = res.checks.find((c) => c.name === 'gh-auth')!
    expect(auth.ok).toBe(false)
    expect(auth.detailKey).toBe('ghAuth.ghCannotRun')
    expect(auth.fixKey).toBe('ghAuth.fixGhFirst')
    expect(calls).not.toContain('gh auth status')
  })

  it('fails when gh is not authenticated', async () => {
    const { exec } = execStub(healthy, fail('not logged in'))
    const res = await runPreflight({ find: findBoth, exec })
    expect(res.ok).toBe(false)
    const auth = res.checks.find((c) => c.name === 'gh-auth')!
    expect(auth.ok).toBe(false)
    expect(auth.detail).toBe('not logged in')
    expect(auth.fix).toContain('gh auth login')
  })

  it('fails (without throwing) when gh auth status cannot start', async () => {
    const { exec } = execStub(healthy, new Error('spawn gh ENOENT'))
    const res = await runPreflight({ find: findBoth, exec })
    const auth = res.checks.find((c) => c.name === 'gh-auth')!
    expect(auth.ok).toBe(false)
    expect(auth.detail).toBe('spawn gh ENOENT')
    expect(auth.fixKey).toBe('ghAuth.fix')
  })

  it('does not try to run anything if git and gh are not installed', async () => {
    const { exec, calls } = execStub(healthy)
    const res = await runPreflight({ find: () => null, exec })
    expect(calls).toEqual([])
    expect(res.ok).toBe(false)
    expect(res.checks.find((c) => c.name === 'gh-auth')!.detailKey).toBe('ghAuth.noGh')
  })
})
