import { describe, expect, it } from 'vitest'
import { filterCommands, scoreMatch } from './filter'

const items = [
  { title: 'Subir cambios (gather)', keywords: ['gather', 'push'] },
  { title: 'Traer cambios (scatter)', keywords: ['scatter', 'pull'] },
  { title: 'Ir a Proyectos' },
  { title: 'Cambiar a tema claro', keywords: ['theme'] },
]

describe('scoreMatch', () => {
  it('query vacía matchea todo con score 0', () => {
    expect(scoreMatch('', items[0])).toBe(0)
  })
  it('prefijo del título gana al substring', () => {
    expect(scoreMatch('subir', items[0])).toBe(0)
    expect(scoreMatch('cambios', items[0])).toBe(1) // límite de palabra
  })
  it('matchea por keyword aunque no esté en el título', () => {
    expect(scoreMatch('push', items[0])).toBe(3)
  })
  it('devuelve null si no matchea', () => {
    expect(scoreMatch('zzz', items[0])).toBeNull()
  })
})

describe('filterCommands', () => {
  it('sin query devuelve todo en orden', () => {
    expect(filterCommands('', items)).toHaveLength(4)
  })
  it('filtra y ordena por relevancia', () => {
    const r = filterCommands('cambi', items)
    expect(r.map((x) => x.title)).toEqual([
      'Cambiar a tema claro', // prefijo
      'Subir cambios (gather)', // límite de palabra
      'Traer cambios (scatter)',
    ])
  })
  it('busca por keyword', () => {
    expect(filterCommands('scatter', items).map((x) => x.title)).toEqual(['Traer cambios (scatter)'])
  })
})
