import { describe, it, expect } from 'vitest'
import { splitForOutgoing, mergeForIncoming } from './settingsMerge'
import type { SettingsObject } from './types'

describe('splitForOutgoing', () => {
  it('syncs everything as-is when overrides are empty', () => {
    const real: SettingsObject = { a: 1, b: 'two', c: { nested: true } }
    expect(splitForOutgoing(real, {})).toEqual({ a: 1, b: 'two', c: { nested: true } })
  })

  it('excludes a declared local key from the shared result', () => {
    const real: SettingsObject = { a: 1, token: 'secret', b: 2 }
    const local: SettingsObject = { token: 'anything' }
    expect(splitForOutgoing(real, local)).toEqual({ a: 1, b: 2 })
  })

  it('excludes a key that is both shared and local (local wins, key removed from shared)', () => {
    const real: SettingsObject = { theme: 'dark', token: 'secret' }
    const local: SettingsObject = { theme: 'light', token: 'secret' }
    // both theme and token are declared local, so shared ends up empty
    expect(splitForOutgoing(real, local)).toEqual({})
  })

  it('excludes a local key even if it is absent from real', () => {
    const real: SettingsObject = { a: 1 }
    const local: SettingsObject = { missing: 'x' }
    expect(splitForOutgoing(real, local)).toEqual({ a: 1 })
  })

  it('does not mutate the input objects', () => {
    const real: SettingsObject = { a: 1, token: 'secret' }
    const local: SettingsObject = { token: 'secret' }
    const realCopy = structuredClone(real)
    const localCopy = structuredClone(local)
    splitForOutgoing(real, local)
    expect(real).toEqual(realCopy)
    expect(local).toEqual(localCopy)
  })
})

describe('mergeForIncoming', () => {
  it('syncs everything as-is when overrides are empty', () => {
    const shared: SettingsObject = { a: 1, b: 'two', c: { nested: true } }
    expect(mergeForIncoming(shared, {})).toEqual({ a: 1, b: 'two', c: { nested: true } })
  })

  it('overlays a local key on top of shared (local wins)', () => {
    const shared: SettingsObject = { a: 1, b: 2 }
    const local: SettingsObject = { token: 'secret' }
    expect(mergeForIncoming(shared, local)).toEqual({ a: 1, b: 2, token: 'secret' })
  })

  it('local value overrides a shared value for the same key', () => {
    const shared: SettingsObject = { theme: 'dark', a: 1 }
    const local: SettingsObject = { theme: 'light' }
    expect(mergeForIncoming(shared, local)).toEqual({ theme: 'light', a: 1 })
  })

  it('rebuilds the full object (delete of a key = full reconstruction, not a patch)', () => {
    // shared lost a key relative to a previous state; incoming yields exactly shared + local
    const shared: SettingsObject = { a: 1 }
    const local: SettingsObject = { token: 'secret' }
    const result = mergeForIncoming(shared, local)
    expect(result).toEqual({ a: 1, token: 'secret' })
    expect(Object.keys(result).sort()).toEqual(['a', 'token'])
  })

  it('does not mutate the input objects', () => {
    const shared: SettingsObject = { a: 1, theme: 'dark' }
    const local: SettingsObject = { theme: 'light' }
    const sharedCopy = structuredClone(shared)
    const localCopy = structuredClone(local)
    mergeForIncoming(shared, local)
    expect(shared).toEqual(sharedCopy)
    expect(local).toEqual(localCopy)
  })
})

describe('outgoing/incoming round-trip', () => {
  it('incoming(outgoing(real), local) reconstructs real when local values match real', () => {
    const real: SettingsObject = { a: 1, b: 2, token: 'secret' }
    const local: SettingsObject = { token: 'secret' }
    const shared = splitForOutgoing(real, local)
    expect(mergeForIncoming(shared, local)).toEqual(real)
  })
})
