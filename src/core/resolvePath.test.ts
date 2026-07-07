import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { resolveEnvPath, findExecutable } from './resolvePath'

describe('resolveEnvPath', () => {
  it('includes common dirs when the PATH is empty', () => {
    const result = resolveEnvPath('')
    const dirs = result.split(':')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/bin')
    expect(dirs).toContain('/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/usr/sbin')
    expect(dirs).toContain('/sbin')
    expect(dirs).toContain(path.join(os.homedir(), '.local', 'bin'))
  })

  it('preserves order: existing first, then the missing common ones', () => {
    const result = resolveEnvPath('/custom/bin')
    const dirs = result.split(':')
    expect(dirs[0]).toBe('/custom/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
  })

  it('deduplicates when the PATH already contained a common dir', () => {
    const result = resolveEnvPath('/usr/bin:/custom/bin')
    const dirs = result.split(':')
    const count = dirs.filter((d) => d === '/usr/bin').length
    expect(count).toBe(1)
    expect(dirs[0]).toBe('/usr/bin')
    expect(dirs[1]).toBe('/custom/bin')
  })

  it('ignores empty PATH segments', () => {
    const result = resolveEnvPath('/custom/bin::')
    const dirs = result.split(':')
    expect(dirs).not.toContain('')
  })
})

describe('findExecutable', () => {
  it('finds git at an absolute path ending in /git', () => {
    const found = findExecutable('git')
    expect(found).not.toBeNull()
    expect(found!.endsWith('/git')).toBe(true)
    expect(path.isAbsolute(found!)).toBe(true)
  })

  it('returns null for a nonexistent binary', () => {
    expect(findExecutable('binario-que-no-existe-xyz')).toBeNull()
  })

  it('respects the provided envPath', () => {
    const found = findExecutable('git', '/usr/bin')
    expect(found).toBe('/usr/bin/git')
  })

  it('returns null if the envPath does not contain the binary', () => {
    expect(findExecutable('git', '/nonexistent/dir')).toBeNull()
  })
})
