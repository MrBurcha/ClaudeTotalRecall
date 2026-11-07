import { describe, expect, it } from 'vitest'
import { ancestorDirs, noteLocation, splitHighlights } from './notebookView'

describe('splitHighlights', () => {
  it('splits text into plain and highlighted runs', () => {
    expect(
      splitHighlights('the deploy and DEPLOY', [
        [4, 10],
        [15, 21],
      ]),
    ).toEqual([
      { text: 'the ', hit: false },
      { text: 'deploy', hit: true },
      { text: ' and ', hit: false },
      { text: 'DEPLOY', hit: true },
    ])
  })

  it('returns the whole text as one plain run without ranges', () => {
    expect(splitHighlights('abc', [])).toEqual([{ text: 'abc', hit: false }])
    expect(splitHighlights('', [])).toEqual([])
  })

  it('tolerates unsorted, overlapping, empty and out-of-bounds ranges', () => {
    const segs = splitHighlights('abcdef', [
      [3, 5],
      [0, 2],
      [1, 4],
      [2, 2],
      [4, 99],
    ])
    expect(segs.map((s) => s.text).join('')).toBe('abcdef')
    expect(segs).toEqual([
      { text: 'ab', hit: true },
      { text: 'cd', hit: true },
      { text: 'e', hit: true },
      { text: 'f', hit: false },
    ])
  })
})

describe('noteLocation', () => {
  it('labels the General root and project roots', () => {
    expect(noteLocation('general/a.md', 'General')).toBe('General')
    expect(noteLocation('general/prompts/a.md', 'General')).toBe('General / prompts')
    expect(noteLocation('projects/Alpha/a.md', 'General')).toBe('Alpha')
    expect(noteLocation('projects/Alpha/specs/v2/a.md', 'General')).toBe('Alpha / specs / v2')
  })
})

describe('ancestorDirs', () => {
  it('lists the tree keys that must be expanded to reveal a note', () => {
    expect(ancestorDirs('general/a.md')).toEqual(['general'])
    expect(ancestorDirs('general/sub/deep/a.md')).toEqual([
      'general',
      'general/sub',
      'general/sub/deep',
    ])
    expect(ancestorDirs('projects/Alpha/a.md')).toEqual(['projects/Alpha'])
    expect(ancestorDirs('projects/Alpha/specs/a.md')).toEqual([
      'projects/Alpha',
      'projects/Alpha/specs',
    ])
  })
})
