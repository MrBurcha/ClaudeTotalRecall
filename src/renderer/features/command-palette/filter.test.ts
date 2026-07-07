import { describe, expect, it } from 'vitest'
import { filterCommands, scoreMatch } from './filter'

const items = [
  { title: 'Subir cambios (outgoing)', keywords: ['outgoing', 'push'] },
  { title: 'Traer cambios (incoming)', keywords: ['incoming', 'pull'] },
  { title: 'Ir a Proyectos' },
  { title: 'Cambiar a tema claro', keywords: ['theme'] },
]

describe('scoreMatch', () => {
  it('empty query matches everything with score 0', () => {
    expect(scoreMatch('', items[0])).toBe(0)
  })
  it('title prefix beats substring', () => {
    expect(scoreMatch('subir', items[0])).toBe(0)
    expect(scoreMatch('cambios', items[0])).toBe(1) // word boundary
  })
  it('matches by keyword even when not in the title', () => {
    expect(scoreMatch('push', items[0])).toBe(3)
  })
  it('returns null when there is no match', () => {
    expect(scoreMatch('zzz', items[0])).toBeNull()
  })
})

describe('filterCommands', () => {
  it('with no query returns everything in order', () => {
    expect(filterCommands('', items)).toHaveLength(4)
  })
  it('filters and sorts by relevance', () => {
    const r = filterCommands('cambi', items)
    expect(r.map((x) => x.title)).toEqual([
      'Cambiar a tema claro', // prefix
      'Subir cambios (outgoing)', // word boundary
      'Traer cambios (incoming)',
    ])
  })
  it('searches by keyword', () => {
    expect(filterCommands('incoming', items).map((x) => x.title)).toEqual(['Traer cambios (incoming)'])
  })
})
