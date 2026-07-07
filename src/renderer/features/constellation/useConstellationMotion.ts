import { useEffect, type RefObject } from 'react'
import type { ConstLink } from './layout'

export type FlowDirection = 'up' | 'down'

/**
 * Animates particles along the current machine's link with requestAnimationFrame,
 * writing cx/cy directly into the group's <circle> elements (no re-render per frame).
 * 'up' = node→vault (outgoing pending/in progress), 'down' = vault→node (incoming).
 * Doesn't start if !enabled (reduced-motion) or there's no direction: the component
 * falls back to a static state. rAF cleanup on every change → safe under StrictMode.
 */
export function useConstellationMotion(
  groupRef: RefObject<SVGGElement>,
  link: ConstLink | null,
  direction: FlowDirection | null,
  enabled: boolean,
  speed = 1,
): void {
  useEffect(() => {
    const group = groupRef.current
    if (!group || !enabled || !link || !direction) return
    const circles = Array.from(group.querySelectorAll('circle'))
    const count = circles.length
    if (count === 0) return

    const phases = circles.map((_, i) => i / count) // initial stagger
    let raf = 0
    let last = performance.now()

    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      for (let i = 0; i < count; i++) {
        phases[i] = (phases[i] + dt * 0.55 * speed) % 1
        const t = direction === 'up' ? phases[i] : 1 - phases[i]
        const x = link.x1 + (link.x2 - link.x1) * t
        const y = link.y1 + (link.y2 - link.y1) * t
        const edge = Math.min(phases[i], 1 - phases[i]) * 2 // fade at the ends
        const c = circles[i]
        c.setAttribute('cx', String(x))
        c.setAttribute('cy', String(y))
        c.setAttribute('opacity', String(Math.min(1, edge * 1.9)))
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [groupRef, link, direction, enabled, speed])
}
