/** Loading block. Dynamic width/height go through style (intrinsic sizing). */
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
