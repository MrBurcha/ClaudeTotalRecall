/**
 * Pure formatting helpers for the file-preview modal (#43): pick a default
 * renderer by extension, and parse `.properties`/`.env`/`.ini` text into ordered
 * lines. No React / no `node:*`, so it runs under the vitest `node` suite and can
 * be imported anywhere.
 */

export type PreviewKind = 'markdown' | 'json' | 'properties' | 'text'

/** Extension (without the dot, lowercased) → renderer. */
const EXT_KIND: Record<string, PreviewKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  json: 'json',
  properties: 'properties',
  env: 'properties',
  ini: 'properties',
  conf: 'properties',
  cfg: 'properties',
}

/**
 * Best-guess renderer for a file name, by extension. Dotfiles count their suffix
 * as the extension (`.env` → properties). Anything unknown → plain text.
 */
export function detectPreviewKind(name: string): PreviewKind {
  const clean = name.replace(/\\/g, '/')
  const base = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot === -1) return 'text'
  return EXT_KIND[base.slice(dot + 1).toLowerCase()] ?? 'text'
}

export type PropLine =
  | { type: 'pair'; key: string; value: string }
  | { type: 'comment'; text: string }
  | { type: 'blank' }

/** First `=` or `:` separator index in a line, or -1 if neither is present. */
function separatorIndex(line: string): number {
  const eq = line.indexOf('=')
  const colon = line.indexOf(':')
  if (eq === -1) return colon
  if (colon === -1) return eq
  return Math.min(eq, colon)
}

/**
 * Parses `.properties`/`.env`/`.ini` text into ordered display lines: comments
 * (`#`, `!`, `;`), `key=value` / `key:value` pairs (split on the first separator,
 * so values may contain `=`), and blank lines. A trailing blank from the final
 * newline is dropped.
 */
export function parseProperties(content: string): PropLine[] {
  const out: PropLine[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      out.push({ type: 'blank' })
      continue
    }
    const t = line.trimStart()
    if (t.startsWith('#') || t.startsWith('!') || t.startsWith(';')) {
      out.push({ type: 'comment', text: line })
      continue
    }
    const sep = separatorIndex(line)
    if (sep === -1) {
      out.push({ type: 'pair', key: line.trim(), value: '' })
      continue
    }
    out.push({ type: 'pair', key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() })
  }
  while (out.length && out[out.length - 1].type === 'blank') out.pop()
  return out
}
