import { describe, expect, it } from 'vitest'
import { withRepoLock } from './repoLock'

describe('withRepoLock', () => {
  it('serializes operations FIFO — no interleaving', async () => {
    const log: string[] = []
    const op = (id: string, ms: number) =>
      withRepoLock(async () => {
        log.push(`start:${id}`)
        await new Promise((r) => setTimeout(r, ms))
        log.push(`end:${id}`)
      })
    // Launch concurrently; a slow first op must still finish before the second starts.
    await Promise.all([op('a', 30), op('b', 1), op('c', 1)])
    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c'])
  })

  it('a failing operation does not wedge the queue', async () => {
    const seen: string[] = []
    const bad = withRepoLock(async () => {
      throw new Error('boom')
    })
    await expect(bad).rejects.toThrow('boom')
    await withRepoLock(async () => {
      seen.push('ran')
    })
    expect(seen).toEqual(['ran'])
  })

  it('returns the operation result', async () => {
    await expect(withRepoLock(async () => 42)).resolves.toBe(42)
  })
})
