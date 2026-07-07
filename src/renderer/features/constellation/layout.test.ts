import { describe, expect, it } from 'vitest'
import { computeConstellation } from './layout'
import type { Machine } from '../../../core/types'

const size = { w: 600, h: 360 }
function machine(os: Machine['os'] = 'linux'): Machine {
  return { os, hostname: 'h', home: '/home/u' }
}

describe('computeConstellation', () => {
  it('places the vault at the horizontal center', () => {
    const { vault } = computeConstellation({ a: machine() }, 'a', size)
    expect(vault.x).toBe(300)
    expect(vault.r).toBeGreaterThan(0)
  })

  it('generates one node and one link per machine', () => {
    const machines = { a: machine(), b: machine('macos'), c: machine() }
    const { nodes, links } = computeConstellation(machines, 'a', size)
    expect(nodes).toHaveLength(3)
    expect(links).toHaveLength(3)
  })

  it('places the current machine first and with a larger radius', () => {
    const machines = { peer: machine(), me: machine() }
    const { nodes } = computeConstellation(machines, 'me', size)
    expect(nodes[0].id).toBe('me')
    expect(nodes[0].isCurrent).toBe(true)
    expect(nodes[0].r).toBeGreaterThan(nodes[1].r)
  })

  it('the current machine sits above the vault (first angle -90°)', () => {
    const { nodes, vault } = computeConstellation({ me: machine() }, 'me', size)
    expect(nodes[0].x).toBeCloseTo(vault.x, 5)
    expect(nodes[0].y).toBeLessThan(vault.y)
  })

  it('links do not start inside the vault (they run between rims)', () => {
    const { links, vault, nodes } = computeConstellation({ me: machine() }, 'me', size)
    const l = links[0]
    // the vault endpoint is ~vault.r from the vault center
    expect(Math.hypot(l.x2 - vault.x, l.y2 - vault.y)).toBeCloseTo(vault.r, 3)
    // the node endpoint is ~node.r from the node center
    expect(Math.hypot(l.x1 - nodes[0].x, l.y1 - nodes[0].y)).toBeCloseTo(nodes[0].r, 3)
  })

  it('tolerates zero machines', () => {
    const { nodes, links, vault } = computeConstellation({}, null, size)
    expect(nodes).toEqual([])
    expect(links).toEqual([])
    expect(vault.x).toBe(300)
  })
})
