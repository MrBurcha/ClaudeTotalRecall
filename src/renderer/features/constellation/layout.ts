import type { Machine } from '../../../core/types'

/**
 * Pure constellation geometry (testable without a DOM). The vault sits at the
 * center and the machines orbit in a ring; the current machine goes first (top)
 * and with a larger radius. Links run from the node's edge to the vault's edge,
 * so the particles/dashes travel between rims, not between centers.
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

  // The current machine first → ends up at the top (angle -90°).
  const ids = Object.keys(machines).sort(
    (a, b) => (a === currentId ? -1 : 0) - (b === currentId ? -1 : 0),
  )
  const n = ids.length
  // Elliptical ring: wider than tall to make use of the space and so the top
  // node (with its label) fits inside the viewBox.
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
    return {
      id: node.id,
      x1,
      y1,
      x2,
      y2,
      length: Math.hypot(x2 - x1, y2 - y1),
      isCurrent: node.isCurrent,
    }
  })

  return { vault, nodes, links }
}
