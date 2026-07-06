/**
 * Ranking de comandos por query (puro, testeable). Substring case-insensitive
 * sobre título + subtítulo + keywords; ordena prefijo > límite-de-palabra >
 * substring. Puntaje menor = mejor.
 */
export interface Rankable {
  title: string
  subtitle?: string
  keywords?: string[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scoreMatch(query: string, item: Rankable): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const title = item.title.toLowerCase()
  const hay = [title, item.subtitle?.toLowerCase() ?? '', ...(item.keywords ?? []).map((k) => k.toLowerCase())].join(
    ' ',
  )
  if (!hay.includes(q)) return null
  if (title.startsWith(q)) return 0
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(title)) return 1
  if (title.includes(q)) return 2
  return 3
}

export function filterCommands<T extends Rankable>(query: string, items: T[]): T[] {
  if (!query.trim()) return items
  return items
    .map((it, i) => ({ it, i, s: scoreMatch(query, it) }))
    .filter((x): x is { it: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it)
}
