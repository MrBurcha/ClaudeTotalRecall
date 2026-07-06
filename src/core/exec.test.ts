import { describe, expect, it } from 'vitest'
import { run } from './exec'

describe('run', () => {
  it('captura stdout y code 0 de un binario real', async () => {
    const r = await run('git', ['--version'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('git version')
  })

  it('devuelve code != 0 sin tirar cuando el comando falla', async () => {
    const r = await run('git', ['rev-parse', '--verify', 'no-such-ref-xyz'])
    expect(r.code).not.toBe(0)
  })

  it('rechaza si el binario no existe', async () => {
    await expect(run('binario-que-no-existe-xyz', [])).rejects.toThrow()
  })
})
