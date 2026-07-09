import { describe, expect, it } from 'vitest'
import { isMemoryIndexPath, isStructuralNoise, parseMemoryPath } from './memoryPath'

describe('isMemoryIndexPath', () => {
  it('matches a MEMORY.md leaf regardless of depth', () => {
    expect(isMemoryIndexPath('memories/projects/foo/memory/MEMORY.md')).toBe(true)
    expect(isMemoryIndexPath('MEMORY.md')).toBe(true)
  })
  it('does not match other files', () => {
    expect(isMemoryIndexPath('memories/projects/foo/memory/notes.md')).toBe(false)
    expect(isMemoryIndexPath('memories/user/CLAUDE.md')).toBe(false)
  })
})

describe('parseMemoryPath', () => {
  describe('project bucket', () => {
    it('parses a project file with the memories/ prefix', () => {
      expect(parseMemoryPath('memories/projects/demo-core/memory/foo.md')).toEqual({
        bucket: 'project',
        project: 'demo-core',
        slot: 'memory',
        rest: 'foo.md',
      })
    })

    it('parses a project file without the memories/ prefix', () => {
      expect(parseMemoryPath('projects/demo/memory/a/b.md')).toEqual({
        bucket: 'project',
        project: 'demo',
        slot: 'memory',
        rest: 'a/b.md', // nested rest is preserved
      })
    })

    it('gives an empty rest for a file directly at the slot root', () => {
      expect(parseMemoryPath('memories/projects/demo/docs')).toEqual({
        bucket: 'project',
        project: 'demo',
        slot: 'docs',
        rest: '',
      })
    })

    it('falls back to unknown when the slot segment is missing', () => {
      expect(parseMemoryPath('memories/projects/demo')).toEqual({
        bucket: 'unknown',
        path: 'memories/projects/demo',
      })
    })
  })

  describe('user bucket', () => {
    it('parses a user-level file (slot only, no rest)', () => {
      expect(parseMemoryPath('memories/user/CLAUDE.md')).toEqual({
        bucket: 'user',
        slot: 'CLAUDE.md',
        rest: '',
      })
    })

    it('parses settings.json', () => {
      expect(parseMemoryPath('memories/user/settings.json')).toEqual({
        bucket: 'user',
        slot: 'settings.json',
        rest: '',
      })
    })

    it('parses a nested file under a user dir slot', () => {
      expect(parseMemoryPath('memories/user/commands/x/y.md')).toEqual({
        bucket: 'user',
        slot: 'commands',
        rest: 'x/y.md',
      })
    })
  })

  describe('pinned bucket', () => {
    it('parses a pinned file', () => {
      expect(parseMemoryPath('memories/pinned/rules')).toEqual({ bucket: 'pinned', pin: 'rules' })
    })
  })

  describe('unknown bucket', () => {
    it.each(['claudetr.json', '.gitignore', '', 'memories/user'])(
      'returns unknown carrying the original path for %j',
      (input) => {
        expect(parseMemoryPath(input)).toEqual({ bucket: 'unknown', path: input })
      },
    )
  })

  it('tolerates backslash separators', () => {
    expect(parseMemoryPath('memories\\projects\\demo\\memory\\foo.md')).toEqual({
      bucket: 'project',
      project: 'demo',
      slot: 'memory',
      rest: 'foo.md',
    })
  })
})

describe('isStructuralNoise', () => {
  it.each([
    'memories/user/commands/.gitkeep',
    'memories/projects/demo/memory/.gitkeep',
    '.gitkeep',
    'memories\\user\\agents\\.gitkeep',
  ])('flags .gitkeep placeholders (%j)', (p) => {
    expect(isStructuralNoise(p)).toBe(true)
  })

  it.each([
    'memories/user/CLAUDE.md',
    'memories/projects/demo/memory/foo.md',
    'memories/user/commands/gitkeep.md',
    '.gitkeeper',
  ])('leaves real files alone (%j)', (p) => {
    expect(isStructuralNoise(p)).toBe(false)
  })
})
