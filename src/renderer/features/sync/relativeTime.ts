/**
 * "hace X" en rioplatense, para el "última vez sincronizado". Puro (recibe `now`)
 * para testear sin reloj. Redondea hacia abajo a la unidad más grande que aplica.
 */
export function relativeTime(then: number, now: number): string {
  const d = Math.max(0, now - then)
  const s = Math.floor(d / 1000)
  if (s < 10) return 'recién'
  if (s < 60) return `hace ${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}
