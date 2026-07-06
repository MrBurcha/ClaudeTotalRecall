import { describe, it, expect } from 'vitest'
import { splitForGather, mergeForScatter } from './settingsMerge'
import type { SettingsObject } from './types'

describe('splitForGather', () => {
  it('syncs everything as-is when overrides are empty', () => {
    const real: SettingsObject = { a: 1, b: 'two', c: { nested: true } }
    expect(splitForGather(real, {})).toEqual({ a: 1, b: 'two', c: { nested: true } })
  })

  it('excludes a declared local key from the shared result', () => {
    const real: SettingsObject = { a: 1, token: 'secret', b: 2 }
    const local: SettingsObject = { token: 'anything' }
    expect(splitForGather(real, local)).toEqual({ a: 1, b: 2 })
  })

  it('excludes a key that is both shared and local (local wins, key removed from shared)', () => {
    const real: SettingsObject = { theme: 'dark', token: 'secret' }
    const local: SettingsObject = { theme: 'light', token: 'secret' }
    // both theme and token are declared local, so shared ends up empty
    expect(splitForGather(real, local)).toEqual({})
  })

  it('excludes a local key even if it is absent from real', () => {
    const real: SettingsObject = { a: 1 }
    const local: SettingsObject = { missing: 'x' }
    expect(splitForGather(real, local)).toEqual({ a: 1 })
  })

  it('does not mutate the input objects', () => {
    const real: SettingsObject = { a: 1, token: 'secret' }
    const local: SettingsObject = { token: 'secret' }
    const realCopy = structuredClone(real)
    const localCopy = structuredClone(local)
    splitForGather(real, local)
    expect(real).toEqual(realCopy)
    expect(local).toEqual(localCopy)
  })
})

describe('mergeForScatter', () => {
  it('syncs everything as-is when overrides are empty', () => {
    const shared: SettingsObject = { a: 1, b: 'two', c: { nested: true } }
    expect(mergeForScatter(shared, {})).toEqual({ a: 1, b: 'two', c: { nested: true } })
  })

  it('overlays a local key on top of shared (local wins)', () => {
    const shared: SettingsObject = { a: 1, b: 2 }
    const local: SettingsObject = { token: 'secret' }
    expect(mergeForScatter(shared, local)).toEqual({ a: 1, b: 2, token: 'secret' })
  })

  it('local value overrides a shared value for the same key', () => {
    const shared: SettingsObject = { theme: 'dark', a: 1 }
    const local: SettingsObject = { theme: 'light' }
    expect(mergeForScatter(shared, local)).toEqual({ theme: 'light', a: 1 })
  })

  it('rebuilds the full object (delete of a key = full reconstruction, not a patch)', () => {
    // shared lost a key relative to a previous state; scatter yields exactly shared + local
    const shared: SettingsObject = { a: 1 }
    const local: SettingsObject = { token: 'secret' }
    const result = mergeForScatter(shared, local)
    expect(result).toEqual({ a: 1, token: 'secret' })
    expect(Object.keys(result).sort()).toEqual(['a', 'token'])
  })

  it('does not mutate the input objects', () => {
    const shared: SettingsObject = { a: 1, theme: 'dark' }
    const local: SettingsObject = { theme: 'light' }
    const sharedCopy = structuredClone(shared)
    const localCopy = structuredClone(local)
    mergeForScatter(shared, local)
    expect(shared).toEqual(sharedCopy)
    expect(local).toEqual(localCopy)
  })
})

describe('gather/scatter round-trip', () => {
  it('scatter(gather(real), local) reconstructs real when local values match real', () => {
    const real: SettingsObject = { a: 1, b: 2, token: 'secret' }
    const local: SettingsObject = { token: 'secret' }
    const shared = splitForGather(real, local)
    expect(mergeForScatter(shared, local)).toEqual(real)
  })
})
