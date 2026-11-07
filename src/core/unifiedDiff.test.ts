import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './unifiedDiff'

const PREAMBLE = [
  'diff --git a/abc123 b/def456',
  'index abc123..def456 100644',
  '--- a/abc123',
  '+++ b/def456',
]

describe('parseUnifiedDiff', () => {
  it('returns no hunks for empty output (identical sides)', () => {
    expect(parseUnifiedDiff('')).toEqual({ hunks: [], binary: false, truncated: false })
  })

  it('parses a hunk into numbered add/del/ctx lines, skipping the preamble', () => {
    const out = [...PREAMBLE, '@@ -1,3 +1,3 @@ heading', ' one', '-two', '+TWO', ' three', ''].join(
      '\n',
    )
    const { hunks, binary, truncated } = parseUnifiedDiff(out)
    expect(binary).toBe(false)
    expect(truncated).toBe(false)
    expect(hunks).toHaveLength(1)
    const h = hunks[0]
    expect(h).toMatchObject({
      header: '@@ -1,3 +1,3 @@ heading',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
    })
    expect(h.lines).toEqual([
      { kind: 'ctx', text: 'one', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'two', oldNo: 2 },
      { kind: 'add', text: 'TWO', newNo: 2 },
      { kind: 'ctx', text: 'three', oldNo: 3, newNo: 3 },
    ])
  })

  it('defaults an omitted hunk count to 1 and keeps multiple hunks apart', () => {
    const out = [
      ...PREAMBLE,
      '@@ -2 +2 @@',
      '-b',
      '+B',
      '@@ -10,2 +10,3 @@',
      ' j',
      '+k',
      ' l',
    ].join('\n')
    const { hunks } = parseUnifiedDiff(out)
    expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      [2, 1, 2, 1],
      [10, 2, 10, 3],
    ])
    expect(hunks[1].lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['ctx', 10, 10],
      ['add', undefined, 11],
      ['ctx', 11, 12],
    ])
  })

  it('reads content that looks like a header or marker by the hunk counts', () => {
    // The removed line's text itself starts with "@@" / "--" — still just content.
    const out = [...PREAMBLE, '@@ -1,2 +1,1 @@', '-@@ -9 +9 @@', '---x', '+y'].join('\n')
    const { hunks } = parseUnifiedDiff(out)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].lines).toEqual([
      { kind: 'del', text: '@@ -9 +9 @@', oldNo: 1 },
      { kind: 'del', text: '--x', oldNo: 2 },
      { kind: 'add', text: 'y', newNo: 1 },
    ])
  })

  it('handles the no-newline marker, CRLF rows and suppressed blank context', () => {
    const out = [
      ...PREAMBLE,
      '@@ -1,3 +1,3 @@',
      ' a\r',
      '', // diff.suppressBlankEmpty: an empty context line has no leading space
      '-c',
      '\\ No newline at end of file',
      '+c',
    ].join('\n')
    const lines = parseUnifiedDiff(out).hunks[0].lines
    expect(lines).toEqual([
      { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'ctx', text: '', oldNo: 2, newNo: 2 },
      { kind: 'del', text: 'c', oldNo: 3 },
      { kind: 'note', text: 'No newline at end of file' },
      { kind: 'add', text: 'c', newNo: 3 },
    ])
  })

  it('flags a binary difference', () => {
    const out = ['diff --git a/x b/y', 'index 1..2 100644', 'Binary files a/x and b/y differ'].join(
      '\n',
    )
    expect(parseUnifiedDiff(out)).toEqual({ hunks: [], binary: true, truncated: false })
  })

  it('stops at the line cap and reports truncation', () => {
    const body = Array.from({ length: 10 }, (_, i) => `+line ${i}`)
    const out = [...PREAMBLE, '@@ -0,0 +1,10 @@', ...body].join('\n')
    const { hunks, truncated } = parseUnifiedDiff(out, 4)
    expect(truncated).toBe(true)
    expect(hunks[0].lines).toHaveLength(4)
    expect(hunks[0].lines[3]).toEqual({ kind: 'add', text: 'line 3', newNo: 4 })
  })

  it('stops reading a hunk whose body does not match its header counts', () => {
    const out = [...PREAMBLE, '@@ -1,2 +1,2 @@', ' a', 'garbage', ' b'].join('\n')
    const lines = parseUnifiedDiff(out).hunks[0].lines
    expect(lines).toEqual([{ kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 }])
  })
})
