import { describe, expect, it } from 'vitest'
import { LOCALE_KEY, THEME_KEY, readStorageMigrated } from './storageKeys'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed))
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

describe('readStorageMigrated (#123)', () => {
  it('moves a pre-rename value to the new key, once', () => {
    const s = memoryStorage({ 'claude-total-recall:theme': 'light' })
    expect(readStorageMigrated(THEME_KEY, s)).toBe('light')
    expect(s.getItem(THEME_KEY)).toBe('light')
    expect(s.getItem('claude-total-recall:theme')).toBeNull()
    expect(readStorageMigrated(THEME_KEY, s)).toBe('light')
  })

  it('the new key wins over a stale old one', () => {
    const s = memoryStorage({ [LOCALE_KEY]: 'es', 'claude-total-recall:locale': 'en' })
    expect(readStorageMigrated(LOCALE_KEY, s)).toBe('es')
  })

  it('nothing stored → null; storage that throws → null', () => {
    expect(readStorageMigrated(LOCALE_KEY, memoryStorage())).toBeNull()
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(readStorageMigrated(THEME_KEY, broken)).toBeNull()
  })
})
