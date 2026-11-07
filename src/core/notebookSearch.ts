import type { NotebookSearchHit, TextRange } from './types'

// Pure matching for the Notebook full-text search (#108): no fs, no git. The
// walker in notebook.ts reads the files and hands each one to matchNote().
//
// Matching is case- and accent-insensitive: both sides are lowercased, decomposed
// (NFD) and stripped of Latin combining diacritics, so "cafe" finds "Café" and
// "ÁRBOL" finds "árbol". Highlight offsets always point into the ORIGINAL text.

/** Latin combining diacritics (the marks NFD splits off "é", "ñ", "ü", …). */
const DIACRITICS = /[̀-ͯ]/g
const DIACRITIC = /[̀-ͯ]/

/** Longest query honored; anything past it is ignored. */
export const MAX_QUERY_LENGTH = 200
const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 100
const LEAD_SNIPPET_MAX = 140

/** Case/accent folding used on both the query and the searched text. */
export function foldText(s: string): string {
  // Final sigma lowercases by context in a whole string but not per character;
  // folding it to σ keeps whole-string and per-character folding identical.
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/ς/g, 'σ')
}

/** The query as it is matched: trimmed, capped and folded ('' = no search). */
export function normalizeQuery(query: string): string {
  return foldText(query.trim().slice(0, MAX_QUERY_LENGTH))
}

/**
 * Folds `text` one code point at a time, recording for every folded UTF-16 unit
 * the [start, end) span of the original code point it came from.
 */
function foldWithMap(text: string): { folded: string; spans: TextRange[] } {
  let folded = ''
  const spans: TextRange[] = []
  let i = 0
  for (const cp of text) {
    const f = foldText(cp)
    for (let k = 0; k < f.length; k++) spans.push([i, i + cp.length])
    folded += f
    i += cp.length
  }
  return { folded, spans }
}

/** Non-overlapping occurrences of an already-folded query in an already-folded text. */
function countIn(folded: string, q: string): number {
  let n = 0
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) n++
  return n
}

/** Every match of the folded query `q` in `text`, as ranges into the original `text`. */
export function findRanges(text: string, q: string): TextRange[] {
  if (!q) return []
  const { folded, spans } = foldWithMap(text)
  const out: TextRange[] = []
  for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + q.length)) {
    const start = spans[at][0]
    let end = spans[at + q.length - 1][1]
    // Keep a decomposed accent (a separate combining code point) with its letter.
    while (end < text.length && DIACRITIC.test(text[end])) end++
    out.push([start, end])
  }
  return out
}

const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff

/** A window of `line` around its first match, with ellipses and shifted ranges. */
function windowAround(line: string, ranges: TextRange[]): { text: string; ranges: TextRange[] } {
  const [s, e] = ranges[0]
  let start = Math.max(0, s - SNIPPET_BEFORE)
  let end = Math.min(line.length, e + SNIPPET_AFTER)
  // Never split a surrogate pair at either edge.
  if (start > 0 && isLowSurrogate(line.charCodeAt(start))) start--
  if (end < line.length && isLowSurrogate(line.charCodeAt(end))) end++
  // Trim surrounding whitespace, but never into the first match.
  while (start < s && /\s/.test(line[start])) start++
  while (end > e && /\s/.test(line[end - 1])) end--
  // Ellipses only when real text was cut (not just indentation / trailing blanks).
  const prefix = line.slice(0, start).trim() ? '…' : ''
  const suffix = line.slice(end).trim() ? '…' : ''
  const shift = prefix.length - start
  return {
    text: prefix + line.slice(start, end) + suffix,
    ranges: ranges
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]): TextRange => [a + shift, b + shift]),
  }
}

/** Snippet around the first line of `content` that contains the folded query. */
export function matchSnippet(
  content: string,
  q: string,
): { text: string; ranges: TextRange[] } | null {
  for (const raw of content.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!foldText(line).includes(q)) continue
    const ranges = findRanges(line, q)
    if (ranges.length > 0) return windowAround(line, ranges)
  }
  return null
}

/** The note's first non-blank line, as context for a name-only match. */
export function leadSnippet(content: string): { text: string; ranges: TextRange[] } | null {
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const cut = line.length > LEAD_SNIPPET_MAX
    let end = cut ? LEAD_SNIPPET_MAX : line.length
    if (cut && isLowSurrogate(line.charCodeAt(end))) end++
    return { text: line.slice(0, end) + (cut ? '…' : ''), ranges: [] }
  }
  return null
}

/**
 * The part of a notebook-relative path the user recognizes as "where the note
 * is": the root prefix (`general/`, `projects/`) is dropped so a query like
 * "general" doesn't match every note, but a project name still does.
 */
function locationPath(path: string): string {
  const segs = path.split('/')
  return segs.slice(1).join('/')
}

/**
 * Matches one note against an already-normalized query (see {@link normalizeQuery}).
 * A hit needs the query in the note's name/path or in its content; null otherwise.
 */
export function matchNote(
  note: { path: string; name: string; content: string },
  q: string,
): NotebookSearchHit | null {
  if (!q) return null
  const nameRanges = findRanges(note.name, q)
  const nameMatch = nameRanges.length > 0 || foldText(locationPath(note.path)).includes(q)
  const contentMatches = countIn(foldText(note.content), q)
  if (!nameMatch && contentMatches === 0) return null
  return {
    path: note.path,
    name: note.name,
    nameRanges,
    nameMatch,
    contentMatches,
    snippet: contentMatches > 0 ? matchSnippet(note.content, q) : leadSnippet(note.content),
  }
}

/** Result order: name/path matches first, then content-only ones; each by path. */
export function compareHits(a: NotebookSearchHit, b: NotebookSearchHit): number {
  if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1
  return a.path.localeCompare(b.path)
}
