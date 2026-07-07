import { describe, expect, it } from 'vitest'
import { run } from './exec'

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
