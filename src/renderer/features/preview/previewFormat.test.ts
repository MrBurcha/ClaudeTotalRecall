import { describe, expect, it } from 'vitest'
import { detectPreviewKind, parseProperties } from './previewFormat'

describe('detectPreviewKind', () => {
  it.each([
    ['CLAUDE.md', 'markdown'],
    ['notes.markdown', 'markdown'],
    ['settings.json', 'json'],
    ['app.properties', 'properties'],
    ['.env', 'properties'],
    ['service.ini', 'properties'],
    ['deploy.conf', 'properties'],
    ['README', 'text'],
    ['.gitignore', 'text'],
    ['weird.xyz', 'text'],
  ] as const)('%s → %s', (name, kind) => {
    expect(detectPreviewKind(name)).toBe(kind)
  })

  it('uses the last extension and is case-insensitive', () => {
    expect(detectPreviewKind('a.b.JSON')).toBe('json')
    expect(detectPreviewKind('deep/path/to/File.MD')).toBe('markdown')
  })
})

describe('parseProperties', () => {
  it('splits key/value on the first separator, keeping later separators in the value', () => {
    expect(parseProperties('URL=https://x?a=1&b=2')).toEqual([
      { type: 'pair', key: 'URL', value: 'https://x?a=1&b=2' },
    ])
    expect(parseProperties('key: value')).toEqual([{ type: 'pair', key: 'key', value: 'value' }])
  })

  it('classifies comments (# ! ;) and blank lines, dropping a trailing newline blank', () => {
    expect(parseProperties('# c1\n!c2\n;c3\n\nA=1\n')).toEqual([
      { type: 'comment', text: '# c1' },
      { type: 'comment', text: '!c2' },
      { type: 'comment', text: ';c3' },
      { type: 'blank' },
      { type: 'pair', key: 'A', value: '1' },
    ])
  })

  it('treats a separatorless non-comment line as a bare key', () => {
    expect(parseProperties('FLAG')).toEqual([{ type: 'pair', key: 'FLAG', value: '' }])
  })

  it('returns empty for empty content', () => {
    expect(parseProperties('')).toEqual([])
  })
})
