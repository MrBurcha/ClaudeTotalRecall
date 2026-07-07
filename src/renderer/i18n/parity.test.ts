import { describe, expect, it } from 'vitest'
import en from './en.json'
import es from './es.json'

type Dict = Record<string, unknown>

/** Flattened dotted key paths of a nested translation object. */
function keys(o: Dict, prefix = ''): string[] {
  return Object.keys(o).flatMap((k) => {
    const p = prefix ? `${prefix}.${k}` : k
    const v = o[k]
    return v && typeof v === 'object' ? keys(v as Dict, p) : [p]
  })
}

describe('i18n catalog parity', () => {
  it('en and es expose identical key sets', () => {
    const enKeys = keys(en as Dict).sort()
    const esKeys = keys(es as Dict).sort()
    expect(esKeys).toEqual(enKeys)
  })

  it('every value is a non-empty string', () => {
    for (const cat of [en, es] as Dict[]) {
      for (const k of keys(cat)) {
        const value = k.split('.').reduce<unknown>((o, part) => (o as Dict)[part], cat)
        expect(typeof value, k).toBe('string')
        expect((value as string).length, k).toBeGreaterThan(0)
      }
    }
  })
})
