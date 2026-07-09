import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlatformAdapter } from '../platform'
import { folderContainsMemoryIndex, MEMORY_MAINTENANCE_PROMPT } from './memoryMaintenance'

const stubAdapter = { expandHome: (p: string) => p } as unknown as PlatformAdapter

describe('MEMORY_MAINTENANCE_PROMPT', () => {
  it('is mirrored verbatim in the README (no drift)', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8')
    expect(readme).toContain(MEMORY_MAINTENANCE_PROMPT)
  })
})

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
