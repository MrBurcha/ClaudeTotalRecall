import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveEnvPath, findExecutable } from './resolvePath'

describe('resolveEnvPath (posix)', () => {
  it('includes common dirs when the PATH is empty', () => {
    const result = resolveEnvPath('', 'linux')
    const dirs = result.split(':')
    expect(dirs).toContain('/opt/homebrew/bin')
    expect(dirs).toContain('/usr/bin')
    expect(dirs).toContain('/bin')
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs).toContain('/usr/sbin')
    expect(dirs).toContain('/sbin')
    // os.homedir() is a Windows path (drive-letter colon) when this runs on a
    // Windows host, which the ':' split would shred — assert on the raw result.
    expect(result).toContain(path.join(os.homedir(), '.local', 'bin'))
  })

  it('preserves order: existing first, then the missing common ones', () => {
    const result = resolveEnvPath('/custom/bin', 'linux')
    const dirs = result.split(':')
    expect(dirs[0]).toBe('/custom/bin')
    expect(dirs).toContain('/opt/homebrew/bin')
  })

  it('deduplicates when the PATH already contained a common dir', () => {
    const result = resolveEnvPath('/usr/bin:/custom/bin', 'linux')
    const dirs = result.split(':')
    const count = dirs.filter((d) => d === '/usr/bin').length
    expect(count).toBe(1)
    expect(dirs[0]).toBe('/usr/bin')
    expect(dirs[1]).toBe('/custom/bin')
  })

  it('ignores empty PATH segments', () => {
    const result = resolveEnvPath('/custom/bin::', 'linux')
    const dirs = result.split(':')
    expect(dirs).not.toContain('')
  })
})

describe('resolveEnvPath (win32)', () => {
  it('splits and joins on ";" so drive-letter paths survive', () => {
    const result = resolveEnvPath('C:\\tools\\bin;C:\\other', 'win32')
    const dirs = result.split(';')
    // The literal ':' after the drive letter must NOT be treated as a separator.
    expect(dirs[0]).toBe('C:\\tools\\bin')
    expect(dirs[1]).toBe('C:\\other')
    expect(dirs).not.toContain('C')
  })

  it('appends the Windows common dirs', () => {
    const result = resolveEnvPath('C:\\tools\\bin', 'win32')
    const dirs = result.split(';')
    expect(dirs.some((d) => d.endsWith(path.join('Git', 'cmd')))).toBe(true)
    expect(dirs.some((d) => d.endsWith('GitHub CLI'))).toBe(true)
  })
})

// These validate the POSIX code path against a real POSIX filesystem (git at an
// absolute /usr/bin path). That can't hold on a Windows host — where there is no
// /usr/bin/git and a Windows temp path's drive colon collides with the ':' PATH
// delimiter — so skip them off POSIX; CI runs on Linux/macOS.
describe.skipIf(process.platform === 'win32')('findExecutable (posix)', () => {
  it('finds git at an absolute path ending in /git', () => {
    const found = findExecutable('git', undefined, 'linux')
    expect(found).not.toBeNull()
    expect(found!.endsWith('/git')).toBe(true)
    expect(path.isAbsolute(found!)).toBe(true)
  })

  it('returns null for a nonexistent binary', () => {
    expect(findExecutable('binario-que-no-existe-xyz', undefined, 'linux')).toBeNull()
  })

  it('respects the provided envPath', () => {
    const found = findExecutable('git', '/usr/bin', 'linux')
    expect(found).toBe('/usr/bin/git')
  })

  it('returns null if the envPath does not contain the binary', () => {
    expect(findExecutable('git', '/nonexistent/dir', 'linux')).toBeNull()
  })
})

// win32 resolution is host-independent: the win32 branch checks isFile() (no
// X_OK) and matches by PATHEXT extension, so a temp dir with a plain `foo.exe`
// file exercises the real code path even on a POSIX CI host.
describe('findExecutable (win32)', () => {
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-winexec-'))
    fs.writeFileSync(path.join(dir, 'git.exe'), '')
    fs.writeFileSync(path.join(dir, 'tool.cmd'), '')
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('resolves a bare name to its .exe via PATHEXT probing', () => {
    const found = findExecutable('git', dir, 'win32')
    expect(found).toBe(path.join(dir, 'git.exe'))
  })

  it('prefers .exe over a .cmd of the same base name (PATHEXT order)', () => {
    // Both git.exe and (hypothetically) git.cmd would match; .EXE precedes .CMD.
    fs.writeFileSync(path.join(dir, 'git.cmd'), '')
    const found = findExecutable('git', dir, 'win32')
    expect(found).toBe(path.join(dir, 'git.exe'))
  })

  it('finds a .cmd when no .exe exists', () => {
    const found = findExecutable('tool', dir, 'win32')
    expect(found).toBe(path.join(dir, 'tool.cmd'))
  })

  it('honors an explicit extension in the name', () => {
    const found = findExecutable('tool.cmd', dir, 'win32')
    expect(found).toBe(path.join(dir, 'tool.cmd'))
  })

  it('returns null for a missing binary', () => {
    expect(findExecutable('nope', dir, 'win32')).toBeNull()
  })
})
