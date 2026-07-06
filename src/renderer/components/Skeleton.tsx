/** Bloque de carga. width/height dinámicos van por style (sizing intrínseco). */
export function Skeleton({
  w = '100%',
  h = 16,
  radius,
}: {
  w?: number | string
  h?: number | string
  radius?: number
}): JSX.Element {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h, borderRadius: radius }} />
}
