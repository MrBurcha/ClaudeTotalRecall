import { useEffect, type RefObject } from 'react'
import type { ConstLink } from './layout'

export type FlowDirection = 'up' | 'down'

/**
 * Anima partículas a lo largo del link de la máquina actual con requestAnimationFrame,
 * escribiendo cx/cy directo en los <circle> del grupo (sin re-render por frame).
 * 'up' = nodo→vault (gather pendiente/en curso), 'down' = vault→nodo (scatter).
 * No arranca si !enabled (reduced-motion) o no hay dirección: el componente cae
 * a un fallback estático. Cleanup del rAF en cada cambio → seguro bajo StrictMode.
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

    const phases = circles.map((_, i) => i / count) // stagger inicial
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
        const edge = Math.min(phases[i], 1 - phases[i]) * 2 // fade en las puntas
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
