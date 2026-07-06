import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = 1_000_000_000_000

describe('relativeTime', () => {
  it('muestra "recién" en los primeros 10 s', () => {
    expect(relativeTime(NOW - 3_000, NOW)).toBe('recién')
    expect(relativeTime(NOW, NOW)).toBe('recién')
  })

  it('escala a segundos, minutos, horas y días', () => {
    expect(relativeTime(NOW - 25_000, NOW)).toBe('hace 25 s')
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe('hace 2 min')
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('hace 3 h')
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('hace 2 d')
  })

  it('nunca da negativo si el reloj se corrió', () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe('recién')
  })
})
