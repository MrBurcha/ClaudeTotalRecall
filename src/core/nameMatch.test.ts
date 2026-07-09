import { describe, expect, it } from 'vitest'
import { scoreNameMatch, unassociatedProjects } from './nameMatch'
import type { Config } from './types'

describe('scoreNameMatch', () => {
  it('scores an exact match (case-insensitive) as 1', () => {
    expect(scoreNameMatch('demo', 'demo')).toBe(1)
    expect(scoreNameMatch('Demo', 'demo')).toBe(1)
    expect(scoreNameMatch('  Zimbify ', 'zimbify')).toBe(1)
  })

  it('scores containment high (a canonical name inside a folder name)', () => {
    // "Zimbify" is contained in the folder "zimbify-core".
    expect(scoreNameMatch('Zimbify', 'zimbify-core')).toBeGreaterThan(0.7)
  })

  it('scores a partial overlap in the medium range via bigram similarity', () => {
    const s = scoreNameMatch('ClaudeTotalRecall', 'ClaudeTR')
    expect(s).toBeGreaterThan(0.4)
    expect(s).toBeLessThan(0.7)
  })

  it('scores unrelated names low', () => {
    expect(scoreNameMatch('Zimbify', 'turnos')).toBeLessThan(0.2)
  })

  it('ranks contains > partial > unrelated', () => {
    const contains = scoreNameMatch('Zimbify', 'zimbify-core')
    const partial = scoreNameMatch('ClaudeTotalRecall', 'ClaudeTR')
    const unrelated = scoreNameMatch('Zimbify', 'turnos')
    expect(contains).toBeGreaterThan(partial)
    expect(partial).toBeGreaterThan(unrelated)
  })

  it('is deterministic and handles empties', () => {
    expect(scoreNameMatch('', 'x')).toBe(0)
    expect(scoreNameMatch('x', '')).toBe(0)
    expect(scoreNameMatch('abc', 'abd')).toBe(scoreNameMatch('abc', 'abd'))
  })
})

describe('unassociatedProjects', () => {
  const config: Config = {
    version: 1,
    repo: { remote: 'r' },
    machines: {},
    projects: {
      here: { folders: { memory: { m1: '/a', m2: '/b' } } },
      elsewhere: { folders: { memory: { m2: '/b' } } },
      empty: { folders: {} },
    },
  }

  it('lists projects configured on other machines but not on this one', () => {
    expect(unassociatedProjects(config, 'm1')).toEqual(['elsewhere'])
  })

  it('excludes projects already associated here and empty projects', () => {
    expect(unassociatedProjects(config, 'm2')).toEqual([]) // both mapped on m2; empty has no slots
  })
})
