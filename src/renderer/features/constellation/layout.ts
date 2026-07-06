import type { Machine } from '../../../core/types'

/**
 * Geometría pura de la constelación (testeable sin DOM). El vault va al centro
 * y las máquinas orbitan en un anillo; la máquina actual va primero (arriba) y
 * con radio mayor. Los links van del borde del nodo al borde del vault, para que
 * las partículas/dashes viajen entre rims, no entre centros.
 */

export interface ConstNode {
  id: string
  x: number
  y: number
  r: number
  isCurrent: boolean
  os: Machine['os']
  label: string
}

export interface ConstLink {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  isCurrent: boolean
}

export interface ConstVault {
  x: number
  y: number
  r: number
}

export interface ConstellationLayout {
  vault: ConstVault
  nodes: ConstNode[]
  links: ConstLink[]
}

const VAULT_R = 32
const NODE_R = 22
const CURRENT_R = 27

export function computeConstellation(
  machines: Record<string, Machine>,
  currentId: string | null,
  size: { w: number; h: number },
): ConstellationLayout {
  const cx = size.w / 2
  const cy = size.h * 0.44
  const vault: ConstVault = { x: cx, y: cy, r: VAULT_R }

  // La máquina actual primero → queda arriba (ángulo -90°).
  const ids = Object.keys(machines).sort(
    (a, b) => (a === currentId ? -1 : 0) - (b === currentId ? -1 : 0),
  )
  const n = ids.length
  // Anillo elíptico: más ancho que alto para aprovechar el espacio y que el
  // nodo de arriba (con su label) entre en el viewBox.
  const rx = size.w * 0.3
  const ry = Math.min(size.h * 0.3, 120)

  const nodes: ConstNode[] = ids.map((id, i) => {
    const angle = ((-90 + i * (360 / Math.max(n, 1))) * Math.PI) / 180
    const isCurrent = id === currentId
    return {
      id,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      r: isCurrent ? CURRENT_R : NODE_R,
      isCurrent,
      os: machines[id].os,
      label: id,
    }
  })

  const links: ConstLink[] = nodes.map((node) => {
    const dx = vault.x - node.x
    const dy = vault.y - node.y
    const dist = Math.hypot(dx, dy) || 1
    const ux = dx / dist
    const uy = dy / dist
    const x1 = node.x + ux * node.r
    const y1 = node.y + uy * node.r
    const x2 = vault.x - ux * vault.r
    const y2 = vault.y - uy * vault.r
    return { id: node.id, x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1), isCurrent: node.isCurrent }
  })

  return { vault, nodes, links }
}
