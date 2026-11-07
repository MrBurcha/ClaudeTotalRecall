/**
 * Pure helpers for the Notebook search and history views (#107/#108). No React,
 * no DOM, so they run under the vitest `node` suite.
 */
import type { TextRange } from '../../../core/types'

export interface Segment {
  text: string
  /** true for a highlighted (matching) run */
  hit: boolean
}

/**
 * Splits `text` into plain/highlighted runs from match ranges. Out-of-bounds,
 * empty and overlapping ranges are tolerated, so a bad range can never drop or
 * duplicate text.
 */
export function splitHighlights(text: string, ranges: TextRange[]): Segment[] {
  const sorted = ranges
    .filter(([a, b]) => a >= 0 && b <= text.length && b > a)
    .sort((x, y) => x[0] - y[0])
  const out: Segment[] = []
  let at = 0
  for (const [a, b] of sorted) {
    const start = Math.max(a, at)
    if (b <= start) continue
    if (start > at) out.push({ text: text.slice(at, start), hit: false })
    out.push({ text: text.slice(start, b), hit: true })
    at = b
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

/**
 * Where a note lives, as shown under a search result: the root (the localized
 * "General" label, or the project name) followed by its folders, e.g.
 * "General / prompts" or "Alpha / specs". `generalLabel` is passed in already
 * translated.
 */
export function noteLocation(path: string, generalLabel: string): string {
  const segs = path.split('/').slice(0, -1)
  if (segs[0] === 'general') return [generalLabel, ...segs.slice(1)].join(' / ')
  if (segs[0] === 'projects' && segs.length >= 2) return segs.slice(1).join(' / ')
  return segs.join(' / ')
}

/**
 * The tree keys to expand so a note is visible: its root and every folder above
 * it ("projects/Alpha/specs/x.md" → ["projects/Alpha", "projects/Alpha/specs"]).
 */
export function ancestorDirs(path: string): string[] {
  const segs = path.split('/').slice(0, -1)
  const rootLen = segs[0] === 'projects' ? 2 : 1
  const out: string[] = []
  for (let i = rootLen; i <= segs.length; i++) out.push(segs.slice(0, i).join('/'))
  return out
}
