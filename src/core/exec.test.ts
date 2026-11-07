import { describe, expect, it } from 'vitest'
import { detectTranslated, run, spawnTarget } from './exec'

describe('run', () => {
  it('captures stdout and code 0 from a real binary', async () => {
    const r = await run('git', ['--version'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('git version')
  })

  it('returns code != 0 without throwing when the command fails', async () => {
    const r = await run('git', ['rev-parse', '--verify', 'no-such-ref-xyz'])
    expect(r.code).not.toBe(0)
  })

  it('rejects if the binary does not exist', async () => {
    await expect(run('binario-que-no-existe-xyz', [])).rejects.toThrow()
  })
})

describe('spawnTarget (#133: git/gh under Rosetta)', () => {
  const translated = { platform: 'darwin' as const, translated: true }

  it('runs git natively through arch on a translated darwin process', () => {
    expect(spawnTarget('/usr/bin/git', ['--version'], translated)).toEqual({
      command: '/usr/bin/arch',
      args: ['-arm64', '-x86_64', '/usr/bin/git', '--version'],
    })
  })

  it('does the same for gh, keeping every argument in order', () => {
    expect(spawnTarget('/opt/homebrew/bin/gh', ['auth', 'status'], translated)).toEqual({
      command: '/usr/bin/arch',
      args: ['-arm64', '-x86_64', '/opt/homebrew/bin/gh', 'auth', 'status'],
    })
  })

  it('handles an unresolved bare name too', () => {
    expect(spawnTarget('git', ['status'], translated).args).toEqual([
      '-arm64',
      '-x86_64',
      'git',
      'status',
    ])
  })

  it('never wraps other binaries', () => {
    expect(spawnTarget('/usr/bin/ssh', ['-V'], translated)).toEqual({
      command: '/usr/bin/ssh',
      args: ['-V'],
    })
    // A name that merely contains "git" is not git.
    expect(spawnTarget('/usr/local/bin/git-lfs', ['version'], translated).command).toBe(
      '/usr/local/bin/git-lfs',
    )
  })

  it('leaves a native darwin process alone', () => {
    expect(
      spawnTarget('/usr/bin/git', ['--version'], { platform: 'darwin', translated: false }),
    ).toEqual({
      command: '/usr/bin/git',
      args: ['--version'],
    })
  })

  it('never wraps on other platforms, whatever the flag says', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(spawnTarget('/usr/bin/git', ['--version'], { platform, translated: true })).toEqual({
        command: '/usr/bin/git',
        args: ['--version'],
      })
    }
  })
})

describe('detectTranslated', () => {
  it('is true when sysctl.proc_translated is 1', async () => {
    expect(await detectTranslated('darwin', async () => '1\n')).toBe(true)
  })

  it('is false when sysctl.proc_translated is 0 (native arm64)', async () => {
    expect(await detectTranslated('darwin', async () => '0\n')).toBe(false)
  })

  it('is false when the key does not exist (Intel Mac) or sysctl fails', async () => {
    const missing = async (): Promise<string> => {
      throw new Error("sysctl: unknown oid 'sysctl.proc_translated'")
    }
    expect(await detectTranslated('darwin', missing)).toBe(false)
  })

  it('never asks sysctl off darwin', async () => {
    let asked = false
    const read = async (): Promise<string> => {
      asked = true
      return '1'
    }
    expect(await detectTranslated('linux', read)).toBe(false)
    expect(await detectTranslated('win32', read)).toBe(false)
    expect(asked).toBe(false)
  })
})
