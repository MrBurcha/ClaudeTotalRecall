import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlatformAdapter } from '../platform'
import { folderContainsMemoryIndex } from './memoryScan'

const stubAdapter = { expandHome: (p: string) => p } as unknown as PlatformAdapter

describe('folderContainsMemoryIndex', () => {
  it('is true for a dir slot that has a top-level MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    writeFileSync(join(dir, 'MEMORY.md'), '# index\n')
    expect(await folderContainsMemoryIndex(stubAdapter, dir, 'dir')).toBe(true)
  })
  it('is false for a dir slot without MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    writeFileSync(join(dir, 'notes.md'), 'x')
    expect(await folderContainsMemoryIndex(stubAdapter, dir, 'dir')).toBe(false)
  })
  it('is true for a file slot pointing at a MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    const f = join(dir, 'MEMORY.md')
    writeFileSync(f, 'x')
    expect(await folderContainsMemoryIndex(stubAdapter, f, 'file')).toBe(true)
  })
  it('is false for a file slot pointing at something else', async () => {
    expect(await folderContainsMemoryIndex(stubAdapter, '/nope/CLAUDE.md', 'file')).toBe(false)
  })
})
