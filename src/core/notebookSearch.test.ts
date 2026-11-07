import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { MAX_PREVIEW_BYTES } from './filePreview'
import { searchNotebook } from './notebook'
import { workingCopyDir } from './service'
import {
  compareHits,
  findRanges,
  foldText,
  leadSnippet,
  matchNote,
  matchSnippet,
  MAX_QUERY_LENGTH,
  normalizeQuery,
} from './notebookSearch'
import type { NotebookSearchHit } from './types'

/** Text covered by each range — what the UI would highlight. */
const covered = (text: string, ranges: [number, number][]): string[] =>
  ranges.map(([a, b]) => text.slice(a, b))

describe('foldText / normalizeQuery', () => {
  it('folds case and Latin accents', () => {
    expect(foldText('Café ÁRBOL Niño')).toBe('cafe arbol nino')
  })

  it('folds a final sigma the same way per character and per word', () => {
    expect(foldText('ΟΔΟΣ')).toBe(foldText('Ο') + foldText('Δ') + foldText('Ο') + foldText('Σ'))
  })

  it('trims, caps and folds the query', () => {
    expect(normalizeQuery('  Résumé ')).toBe('resume')
    expect(normalizeQuery('   ')).toBe('')
    expect(normalizeQuery('x'.repeat(MAX_QUERY_LENGTH + 50))).toHaveLength(MAX_QUERY_LENGTH)
  })
})

describe('findRanges', () => {
  it('finds every case/accent-insensitive match as ranges into the original text', () => {
    const text = 'El café y el CAFE y el cafecito'
    expect(covered(text, findRanges(text, 'cafe'))).toEqual(['café', 'CAFE', 'cafe'])
  })

  it('keeps a decomposed accent with its letter and survives surrogate pairs', () => {
    const decomposed = 'café ok' // "café" written as e + combining acute
    expect(covered(decomposed, findRanges(decomposed, 'cafe'))).toEqual(['café'])
    const emoji = '🎉 Party 🎉 party'
    expect(covered(emoji, findRanges(emoji, 'party'))).toEqual(['Party', 'party'])
  })

  it('returns nothing for an empty query or no match', () => {
    expect(findRanges('abc', '')).toEqual([])
    expect(findRanges('abc', 'zz')).toEqual([])
  })
})

describe('matchSnippet', () => {
  it('returns the first matching line with the match highlighted', () => {
    const content = '# Title\n\nSome intro\n  The deploy steps are here\r\nlater deploy'
    const s = matchSnippet(content, 'deploy')!
    expect(s.text).toBe('The deploy steps are here')
    expect(covered(s.text, s.ranges)).toEqual(['deploy'])
  })

  it('windows a long line with ellipses and shifts the ranges', () => {
    const line = `${'a'.repeat(80)} needle ${'b'.repeat(200)}`
    const s = matchSnippet(line, 'needle')!
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text.length).toBeLessThan(line.length)
    expect(covered(s.text, s.ranges)).toEqual(['needle'])
  })

  it('does not cut a surrogate pair at the window edges', () => {
    const line = `${'🎉'.repeat(30)}needle${'🎉'.repeat(60)}`
    const s = matchSnippet(line, 'needle')!
    // A lone surrogate would show as U+FFFD; the window must stay well-formed.
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s.text),
    ).toBe(false)
    expect(covered(s.text, s.ranges)).toEqual(['needle'])
  })

  it('returns null when no line matches', () => {
    expect(matchSnippet('one\ntwo', 'three')).toBeNull()
  })
})

describe('leadSnippet', () => {
  it('uses the first non-blank line, cut when long', () => {
    expect(leadSnippet('\n\n  First line  \nsecond')).toEqual({ text: 'First line', ranges: [] })
    const long = leadSnippet('x'.repeat(500))!
    expect(long.text.endsWith('…')).toBe(true)
    expect(long.text.length).toBeLessThan(200)
    expect(leadSnippet(' \n\t\n')).toBeNull()
  })
})

describe('matchNote', () => {
  const note = (path: string, content: string) => ({
    path,
    name: path.split('/').pop()!,
    content,
  })

  it('matches by name (highlighting it) with the first line as context', () => {
    const hit = matchNote(note('general/Deploy Notes.md', '# Steps\nrun it'), 'deploy')!
    expect(hit.nameMatch).toBe(true)
    expect(covered(hit.name, hit.nameRanges)).toEqual(['Deploy'])
    expect(hit.contentMatches).toBe(0)
    expect(hit.snippet).toEqual({ text: '# Steps', ranges: [] })
  })

  it('matches by content, counting occurrences', () => {
    const hit = matchNote(note('general/a.md', 'alpha\nbeta Alpha\nALPHA'), 'alpha')!
    expect(hit.nameMatch).toBe(false)
    expect(hit.contentMatches).toBe(3)
    expect(covered(hit.snippet!.text, hit.snippet!.ranges)).toEqual(['alpha'])
  })

  it('matches a folder or project name in the path, but not the root prefix', () => {
    expect(matchNote(note('projects/Zimbify/x.md', ''), 'zimb')?.nameMatch).toBe(true)
    expect(matchNote(note('general/sub/x.md', ''), 'sub')?.nameMatch).toBe(true)
    expect(matchNote(note('general/x.md', 'nothing'), 'general')).toBeNull()
    expect(matchNote(note('projects/A/x.md', 'nothing'), 'projects')).toBeNull()
  })

  it('returns null for no match or an empty query', () => {
    expect(matchNote(note('general/a.md', 'hello'), 'bye')).toBeNull()
    expect(matchNote(note('general/a.md', 'hello'), '')).toBeNull()
  })
})

describe('compareHits', () => {
  const hit = (path: string, nameMatch: boolean): NotebookSearchHit => ({
    path,
    name: path,
    nameRanges: [],
    nameMatch,
    contentMatches: 1,
    snippet: null,
  })

  it('puts name matches first, then sorts by path', () => {
    const sorted = [hit('b', false), hit('z', true), hit('a', false), hit('c', true)].sort(
      compareHits,
    )
    expect(sorted.map((h) => h.path)).toEqual(['c', 'z', 'a', 'b'])
  })
})

describe('searchNotebook (working copy)', () => {
  const bases: string[] = []
  afterEach(async () => {
    for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
  })

  /** A working copy holding only Notebook files (search needs no commits). */
  async function notebookWith(files: Record<string, string | Buffer>) {
    const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-nbs-'))
    bases.push(base)
    const a = createPlatformAdapter(process.platform, join(base, 'home'))
    const root = join(workingCopyDir(a), 'memories/notebook')
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, rel)), { recursive: true })
      await writeFile(join(root, rel), content)
    }
    return { a, base, root }
  }

  it('finds notes by name and content across roots, name matches first', async () => {
    const { a } = await notebookWith({
      'general/ideas.md': 'Plan the Deploy pipeline',
      'general/sub/deploy.md': '# Checklist',
      'projects/Alpha/notes.md': 'nothing here',
      'projects/Alpha/.gitkeep': '',
    })
    const r = await searchNotebook(a, { query: 'DEPLOY' })
    expect(r.truncated).toBe(false)
    expect(r.hits.map((h) => [h.path, h.nameMatch, h.contentMatches])).toEqual([
      ['general/sub/deploy.md', true, 0],
      ['general/ideas.md', false, 1],
    ])
    const content = r.hits[1].snippet!
    expect(content.text.slice(content.ranges[0][0], content.ranges[0][1])).toBe('Deploy')
  })

  it('returns nothing for a blank query', async () => {
    const { a } = await notebookWith({ 'general/a.md': 'x' })
    expect(await searchNotebook(a, { query: '   ' })).toEqual({ hits: [], truncated: false })
  })

  it('skips binary and secret-shaped files and reads only the first 1 MiB', async () => {
    const big = `${'a'.repeat(MAX_PREVIEW_BYTES)}needle-past-the-cap`
    const { a } = await notebookWith({
      'general/bin.dat': Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00]), // "needle\0"
      'general/log.jsonl': 'needle',
      'general/big.md': big,
      'general/ok.md': 'a needle',
    })
    const r = await searchNotebook(a, { query: 'needle' })
    expect(r.hits.map((h) => h.path)).toEqual(['general/ok.md'])
  })

  it('caps the number of results', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 7; i++) files[`general/n${i}.md`] = 'match'
    const { a } = await notebookWith(files)
    const r = await searchNotebook(a, { query: 'match', limit: 3 })
    expect(r.hits).toHaveLength(3)
    expect(r.truncated).toBe(true)
  })

  it('never follows a symlink out of the Notebook', async () => {
    const { a, base, root } = await notebookWith({ 'general/a.md': 'inside' })
    const outside = join(base, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.md'), 'leak')
    try {
      // 'junction' lets Windows create a directory link without admin rights.
      await symlink(outside, join(root, 'general/link'), 'junction')
    } catch {
      return // links unavailable on this machine
    }
    expect((await searchNotebook(a, { query: 'leak' })).hits).toEqual([])
  })
})
