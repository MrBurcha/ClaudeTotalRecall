import { describe, expect, it } from 'vitest'
import { relativeParts } from './relativeTime'

const NOW = 1_000_000_000_000

describe('relativeParts', () => {
  it('returns the "now" bucket within the first 10s', () => {
    expect(relativeParts(NOW - 3_000, NOW)).toEqual({ key: 'now', count: 0 })
    expect(relativeParts(NOW, NOW)).toEqual({ key: 'now', count: 0 })
  })

  it('scales to seconds, minutes, hours and days', () => {
    expect(relativeParts(NOW - 25_000, NOW)).toEqual({ key: 'seconds', count: 25 })
    expect(relativeParts(NOW - 2 * 60_000, NOW)).toEqual({ key: 'minutes', count: 2 })
    expect(relativeParts(NOW - 3 * 3_600_000, NOW)).toEqual({ key: 'hours', count: 3 })
    expect(relativeParts(NOW - 2 * 86_400_000, NOW)).toEqual({ key: 'days', count: 2 })
  })

  it('never goes negative if the clock jumped', () => {
    expect(relativeParts(NOW + 5_000, NOW)).toEqual({ key: 'now', count: 0 })
  })
})
