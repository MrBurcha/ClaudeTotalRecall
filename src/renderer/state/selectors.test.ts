import { describe, expect, it } from 'vitest'
import { canSync, conflicts, needsOnboarding, onboardingStep } from './selectors'
import type { Config, PreflightResult, RepoStatus } from '../../core/types'

const okPreflight: PreflightResult = { ok: true, checks: [] }
const badPreflight: PreflightResult = { ok: false, checks: [] }

function cfg(projects: Config['projects'] = {}): Config {
  return { version: 1, repo: { remote: 'git@x' }, machines: {}, projects }
}

describe('onboardingStep', () => {
  it('requires preflight when git/gh/auth is missing', () => {
    expect(onboardingStep({ preflight: badPreflight, config: null, machineId: null })).toBe(
      'preflight',
    )
  })

  it('requires connect with preflight ok but no config', () => {
    expect(onboardingStep({ preflight: okPreflight, config: null, machineId: null })).toBe(
      'connect',
    )
  })

  it('requires register with config but no machine', () => {
    expect(onboardingStep({ preflight: okPreflight, config: cfg(), machineId: null })).toBe(
      'register',
    )
  })

  it('suggests the first project when there are no projects', () => {
    expect(onboardingStep({ preflight: okPreflight, config: cfg(), machineId: 'm1' })).toBe(
      'first-project',
    )
  })

  it('is ready when there are projects', () => {
    const c = cfg({ demo: { folders: {} } })
    expect(onboardingStep({ preflight: okPreflight, config: c, machineId: 'm1' })).toBe('done')
  })
})

describe('needsOnboarding', () => {
  it('blocks on preflight/connect/register', () => {
    expect(needsOnboarding({ preflight: badPreflight, config: null, machineId: null })).toBe(true)
    expect(needsOnboarding({ preflight: okPreflight, config: null, machineId: null })).toBe(true)
    expect(needsOnboarding({ preflight: okPreflight, config: cfg(), machineId: null })).toBe(true)
  })

  it('does NOT block for missing projects nor when ready', () => {
    expect(needsOnboarding({ preflight: okPreflight, config: cfg(), machineId: 'm1' })).toBe(false)
    const c = cfg({ demo: { folders: {} } })
    expect(needsOnboarding({ preflight: okPreflight, config: c, machineId: 'm1' })).toBe(false)
  })
})

describe('canSync', () => {
  it('requires config + machine + preflight ok', () => {
    expect(canSync({ config: cfg(), machineId: 'm1', preflight: okPreflight })).toBe(true)
    expect(canSync({ config: null, machineId: 'm1', preflight: okPreflight })).toBe(false)
    expect(canSync({ config: cfg(), machineId: null, preflight: okPreflight })).toBe(false)
    expect(canSync({ config: cfg(), machineId: 'm1', preflight: badPreflight })).toBe(false)
  })
})

describe('conflicts', () => {
  it('derives from status.conflicted', () => {
    const status: RepoStatus = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      dirty: false,
      conflicted: ['a.md', 'b.md'],
    }
    expect(conflicts({ status })).toEqual(['a.md', 'b.md'])
    expect(conflicts({ status: null })).toEqual([])
  })
})
