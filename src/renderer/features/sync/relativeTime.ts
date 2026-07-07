/**
 * Locale-agnostic "time ago" bucket for the "last synced" label. Pure (takes `now`)
 * so it's testable without a clock, and returns a { key, count } tuple the render
 * layer localizes via t('relativeTime.<key>', { count }). Rounds down to the largest
 * unit that applies.
 */
export type RelativeUnit = 'now' | 'seconds' | 'minutes' | 'hours' | 'days'

export interface RelativeParts {
  key: RelativeUnit
  /** amount in the chosen unit; 0 for the 'now' bucket */
  count: number
}

export function relativeParts(then: number, now: number): RelativeParts {
  const d = Math.max(0, now - then)
  const s = Math.floor(d / 1000)
  if (s < 10) return { key: 'now', count: 0 }
  if (s < 60) return { key: 'seconds', count: s }
  const min = Math.floor(s / 60)
  if (min < 60) return { key: 'minutes', count: min }
  const h = Math.floor(min / 60)
  if (h < 24) return { key: 'hours', count: h }
  return { key: 'days', count: Math.floor(h / 24) }
}
