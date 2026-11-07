import type { DiffHunk, DiffLine } from './types'

/** Default cap on the number of hunk lines returned (keeps a huge diff renderable). */
export const MAX_DIFF_LINES = 5000

export interface ParsedDiff {
  hunks: DiffHunk[]
  /** git printed "Binary files … differ" instead of a line diff */
  binary: boolean
  /** the line cap was hit and the rest of the diff was dropped */
  truncated: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parses git's unified diff output (one file) into hunks. Pure: no git, no I/O.
 *
 * Everything outside a hunk (the `diff --git`/`index`/`---`/`+++` preamble) is
 * ignored, so it doesn't matter how git names the two sides. Each hunk is read by
 * the line counts in its `@@ -a,b +c,d @@` header, so a content line is never
 * mistaken for a header. Lines keep their text without the leading marker; a
 * trailing `\r` is dropped. An empty row inside a hunk is an empty context line
 * (git emits it that way with `diff.suppressBlankEmpty`). `\ No newline at end of
 * file` becomes a `note` line.
 */
export function parseUnifiedDiff(output: string, maxLines = MAX_DIFF_LINES): ParsedDiff {
  const hunks: DiffHunk[] = []
  let binary = false
  let truncated = false
  let total = 0
  let cur: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0

  for (const raw of output.split('\n')) {
    const row = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const inBody = cur !== null && (oldLeft > 0 || newLeft > 0)
    let line: DiffLine | null = null

    if (cur && row.startsWith('\\')) {
      // Marker for the line just before it; valid right after a hunk's last line too.
      line = { kind: 'note', text: row.slice(1).trim() }
    } else if (inBody) {
      const mark = row[0]
      if (mark === '+' && newLeft > 0) {
        line = { kind: 'add', text: row.slice(1), newNo: newNo++ }
        newLeft--
      } else if (mark === '-' && oldLeft > 0) {
        line = { kind: 'del', text: row.slice(1), oldNo: oldNo++ }
        oldLeft--
      } else if ((mark === ' ' || row === '') && oldLeft > 0 && newLeft > 0) {
        line = { kind: 'ctx', text: row.slice(1), oldNo: oldNo++, newNo: newNo++ }
        oldLeft--
        newLeft--
      } else {
        // Malformed body: stop reading this hunk rather than mis-number lines.
        oldLeft = newLeft = 0
      }
    } else {
      const m = HUNK_RE.exec(row)
      if (m) {
        cur = {
          header: row,
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
        }
        hunks.push(cur)
        oldNo = cur.oldStart
        newNo = cur.newStart
        oldLeft = cur.oldLines
        newLeft = cur.newLines
      } else if (/^Binary files .* differ$/.test(row)) {
        binary = true
      }
      continue
    }

    if (!line || !cur) continue
    if (total >= maxLines) {
      truncated = true
      break
    }
    cur.lines.push(line)
    total++
  }
  return { hunks, binary, truncated }
}
