import { describe, expect, it } from 'vitest'
import { computeConstellation } from './layout'
import type { Machine } from '../../../core/types'

const size = { w: 600, h: 360 }
function machine(os: Machine['os'] = 'linux'): Machine {
  return { os, hostname: 'h', home: '/home/u' }
}

describe('computeConstellation', () => {
  it('pone el vault en el centro horizontal', () => {
    const { vault } = computeConstellation({ a: machine() }, 'a', size)
    expect(vault.x).toBe(300)
    expect(vault.r).toBeGreaterThan(0)
  })

  it('genera un nodo y un link por máquina', () => {
    const machines = { a: machine(), b: machine('macos'), c: machine() }
    const { nodes, links } = computeConstellation(machines, 'a', size)
    expect(nodes).toHaveLength(3)
    expect(links).toHaveLength(3)
  })

  it('coloca la máquina actual primera y con radio mayor', () => {
    const machines = { peer: machine(), me: machine() }
    const { nodes } = computeConstellation(machines, 'me', size)
    expect(nodes[0].id).toBe('me')
    expect(nodes[0].isCurrent).toBe(true)
    expect(nodes[0].r).toBeGreaterThan(nodes[1].r)
  })

  it('la máquina actual queda arriba del vault (primer ángulo -90°)', () => {
    const { nodes, vault } = computeConstellation({ me: machine() }, 'me', size)
    expect(nodes[0].x).toBeCloseTo(vault.x, 5)
    expect(nodes[0].y).toBeLessThan(vault.y)
  })

  it('los links no arrancan dentro del vault (van entre rims)', () => {
    const { links, vault, nodes } = computeConstellation({ me: machine() }, 'me', size)
    const l = links[0]
    // el extremo del vault está a ~vault.r del centro del vault
    expect(Math.hypot(l.x2 - vault.x, l.y2 - vault.y)).toBeCloseTo(vault.r, 3)
    // el extremo del nodo está a ~node.r del centro del nodo
    expect(Math.hypot(l.x1 - nodes[0].x, l.y1 - nodes[0].y)).toBeCloseTo(nodes[0].r, 3)
  })

  it('tolera cero máquinas', () => {
    const { nodes, links, vault } = computeConstellation({}, null, size)
    expect(nodes).toEqual([])
    expect(links).toEqual([])
    expect(vault.x).toBe(300)
  })
})
