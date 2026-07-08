import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import type { Config } from './types'
import {
  decodeClaudeProjectDir,
  discoverProjectSources,
  pickReference,
  proposeMachineMapping,
  remapPath,
  scanClaudeProjects,
  slug,
} from './discovery'

const FAKE_HOME = '/tmp/claude-total-recall-fake-home'

const dirs: string[] = []

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'ctr-discovery-'))
  dirs.push(d)
  return d
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

function emptyConfig(): Config {
  return { version: 1, repo: { remote: 'r' }, machines: {}, projects: {} }
}

function linuxAdapter(home = FAKE_HOME) {
  return createPlatformAdapter('linux', home)
}

describe('slug', () => {
  it('lowercases and hyphenates, trimming stray separators', () => {
    expect(slug('My Project!')).toBe('my-project')
    expect(slug('  eager  church  ')).toBe('eager-church')
    expect(slug('already-ok')).toBe('already-ok')
  })
})

describe('discoverProjectSources', () => {
  it('recognizes the Claude vocabulary inside a project dir with correct kinds and name', async () => {
    const base = await tmp()
    const proj = join(base, 'eager-church-agent')
    await mkdir(join(proj, 'memory'), { recursive: true })
    await mkdir(join(proj, 'commands'), { recursive: true })
    await writeFile(join(proj, 'CLAUDE.md'), '# hi')
    await writeFile(join(proj, 'settings.json'), '{}')

    const p = await discoverProjectSources(proj, emptyConfig(), linuxAdapter(), 'this')

    expect(p.projectName).toBe('eager-church-agent')
    expect(p.rootIsMemory).toBe(false)
    const bySlot = new Map(p.slots.map((s) => [s.slot, s]))
    expect(bySlot.get('memory')?.kind).toBe('dir')
    expect(bySlot.get('commands')?.kind).toBe('dir')
    expect(bySlot.get('CLAUDE.md')?.kind).toBe('file')
    expect(bySlot.get('settings.json')?.kind).toBe('file')
    expect(p.slots).toHaveLength(4)
    expect(p.slots.every((s) => s.include)).toBe(true)
    // memory is listed first for a stable UI
    expect(p.slots[0].slot).toBe('memory')
  })

  it('treats a selected `memory` folder as a single memory slot named after its parent', async () => {
    const base = await tmp()
    const memory = join(base, 'foo', 'memory')
    await mkdir(memory, { recursive: true })

    const p = await discoverProjectSources(memory, emptyConfig(), linuxAdapter(), 'this')

    expect(p.rootIsMemory).toBe(true)
    expect(p.projectName).toBe('foo')
    expect(p.slots).toHaveLength(1)
    expect(p.slots[0]).toMatchObject({ slot: 'memory', kind: 'dir', path: memory })
  })

  it('skips transcripts, secrets and unrecognized files', async () => {
    const base = await tmp()
    const proj = join(base, 'p')
    await mkdir(join(proj, 'memory'), { recursive: true })
    await writeFile(join(proj, 'session.jsonl'), '{}')
    await writeFile(join(proj, '.credentials.json'), '{}')
    await writeFile(join(proj, '.claude.json'), '{}')
    await writeFile(join(proj, 'notes.txt'), 'x')

    const p = await discoverProjectSources(proj, emptyConfig(), linuxAdapter(), 'this')

    expect(p.slots.map((s) => s.slot)).toEqual(['memory'])
  })

  it('rejects a vocabulary name whose type does not match the expected kind', async () => {
    const base = await tmp()
    const proj = join(base, 'p')
    await mkdir(proj, { recursive: true })
    // `commands` exists but as a FILE — expected a dir, so it must be dropped.
    await writeFile(join(proj, 'commands'), 'not a dir')
    await writeFile(join(proj, 'CLAUDE.md'), '# hi')

    const p = await discoverProjectSources(proj, emptyConfig(), linuxAdapter(), 'this')

    expect(p.slots.map((s) => s.slot)).toEqual(['CLAUDE.md'])
  })

  it('follows symlinks when recognizing (a symlinked dir is accepted)', async () => {
    const base = await tmp()
    const proj = join(base, 'p')
    await mkdir(join(proj, 'realcmds'), { recursive: true })
    await symlink(join(proj, 'realcmds'), join(proj, 'commands'))

    const p = await discoverProjectSources(proj, emptyConfig(), linuxAdapter(), 'this')

    expect(p.slots.map((s) => s.slot)).toContain('commands')
    expect(p.slots.find((s) => s.slot === 'commands')?.kind).toBe('dir')
  })

  it('marks a candidate that overlaps an already-synced path as excluded', async () => {
    const base = await tmp()
    const proj = join(base, 'p')
    const memory = join(proj, 'memory')
    await mkdir(memory, { recursive: true })

    const config: Config = {
      version: 1,
      repo: { remote: 'r' },
      machines: {},
      projects: {
        other: { folders: { x: { this: memory } }, slotKinds: { x: 'dir' } },
      },
    }

    const p = await discoverProjectSources(proj, config, linuxAdapter(), 'this')
    const mem = p.slots.find((s) => s.slot === 'memory')
    expect(mem?.include).toBe(false)
    expect(mem?.collision?.where).toBe('other/x')
  })

  it('returns an empty proposal for an empty directory (no throw)', async () => {
    const base = await tmp()
    const proj = join(base, 'empty')
    await mkdir(proj, { recursive: true })

    const p = await discoverProjectSources(proj, emptyConfig(), linuxAdapter(), 'this')
    expect(p.slots).toEqual([])
  })

  it('returns an empty proposal for a nonexistent directory (no throw)', async () => {
    const base = await tmp()
    const p = await discoverProjectSources(
      join(base, 'nope'),
      emptyConfig(),
      linuxAdapter(),
      'this',
    )
    expect(p.slots).toEqual([])
  })
})

describe('remapPath', () => {
  it('swaps the reference home prefix for the target home', () => {
    expect(remapPath('/Users/x/.claude/projects/foo/memory', '/Users/x', '/home/y')).toBe(
      '/home/y/.claude/projects/foo/memory',
    )
  })

  it('maps the home root itself', () => {
    expect(remapPath('/Users/x', '/Users/x', '/home/y')).toBe('/home/y')
  })

  it('returns null when the path is not under the reference home', () => {
    expect(remapPath('/opt/shared/memory', '/Users/x', '/home/y')).toBeNull()
  })

  it('respects the separator boundary (no false prefix match)', () => {
    expect(remapPath('/Users/xavier/foo', '/Users/x', '/home/y')).toBeNull()
  })
})

describe('pickReference', () => {
  function multiMachine(): Config {
    return {
      version: 1,
      repo: { remote: 'r' },
      machines: {
        mac: { os: 'macos', hostname: 'mac', home: '/Users/x' },
        lin: { os: 'linux', hostname: 'lin', home: '/home/z' },
        lin2: { os: 'linux', hostname: 'lin2', home: '/home/w' },
      },
      projects: {
        demo: {
          folders: {
            memory: {
              mac: '/Users/x/.claude/projects/demo/memory',
              lin: '/home/z/.claude/projects/demo/memory',
            },
          },
        },
      },
    }
  }

  it('prefers a machine with the same OS as the target', () => {
    expect(pickReference(multiMachine(), 'demo', 'memory', 'lin2')).toBe('lin')
  })

  it('falls back to any remappable machine when no same-OS match exists', () => {
    const c = multiMachine()
    // target is macos but only linux `lin` remains (mac would be excluded as target)
    expect(pickReference(c, 'demo', 'memory', 'mac')).toBe('lin')
  })

  it('returns null when the slot exists only on the target machine', () => {
    const c = multiMachine()
    c.projects.demo.folders.memory = { lin2: '/home/w/.claude/projects/demo/memory' }
    expect(pickReference(c, 'demo', 'memory', 'lin2')).toBeNull()
  })
})

describe('proposeMachineMapping', () => {
  function baseConfig(targetHome: string): Config {
    return {
      version: 1,
      repo: { remote: 'r' },
      machines: {
        mac: { os: 'macos', hostname: 'mac', home: '/Users/x' },
        lin: { os: 'linux', hostname: 'lin', home: targetHome },
      },
      projects: {
        demo: {
          folders: { memory: { mac: '/Users/x/.claude/projects/demo/memory' } },
          slotKinds: { memory: 'dir' },
        },
      },
    }
  }

  it('remaps to the target home and confirms an existing path on disk', async () => {
    const home = await tmp()
    const real = join(home, '.claude/projects/demo/memory')
    await mkdir(real, { recursive: true })

    const proposal = await proposeMachineMapping(
      'demo',
      'lin',
      baseConfig(home),
      linuxAdapter(home),
    )
    const mem = proposal.slots.find((s) => s.slot === 'memory')!
    expect(mem.status).toBe('ok')
    expect(mem.proposedPath).toBe(real)
    expect(mem.exists).toBe(true)
    expect(mem.referenceMachine).toBe('mac')
    expect(mem.alreadyConfigured).toBe(false)
  })

  it('reports a remapped path that is missing on disk', async () => {
    const home = await tmp()
    const proposal = await proposeMachineMapping(
      'demo',
      'lin',
      baseConfig(home),
      linuxAdapter(home),
    )
    const mem = proposal.slots.find((s) => s.slot === 'memory')!
    expect(mem.status).toBe('missing')
    expect(mem.proposedPath).toBe(join(home, '.claude/projects/demo/memory'))
    expect(mem.exists).toBe(false)
  })

  it('reports notUnderHome when the reference path is outside the reference home', async () => {
    const home = await tmp()
    const config = baseConfig(home)
    config.projects.demo.folders.memory = { mac: '/opt/shared/demo/memory' }
    const proposal = await proposeMachineMapping('demo', 'lin', config, linuxAdapter(home))
    const mem = proposal.slots.find((s) => s.slot === 'memory')!
    expect(mem.status).toBe('notUnderHome')
    expect(mem.proposedPath).toBeNull()
    expect(mem.referencePath).toBe('/opt/shared/demo/memory')
  })

  it('flags a slot already configured on the target machine', async () => {
    const home = await tmp()
    const config = baseConfig(home)
    config.projects.demo.folders.memory.lin = join(home, '.claude/projects/demo/memory')
    const proposal = await proposeMachineMapping('demo', 'lin', config, linuxAdapter(home))
    const mem = proposal.slots.find((s) => s.slot === 'memory')!
    expect(mem.alreadyConfigured).toBe(true)
  })
})

describe('decodeClaudeProjectDir', () => {
  // A real-ish tree: only these paths "exist".
  const tree = new Set([
    '/home',
    '/home/mburcheri',
    '/home/mburcheri/Development',
    '/home/mburcheri/Development/zimbify-core',
    '/home/mburcheri/Development/ClaudeTotalRecall',
  ])
  const exists = (p: string): boolean => tree.has(p)

  it('recovers a hyphenated last segment via filesystem probing', () => {
    expect(decodeClaudeProjectDir('-home-mburcheri-Development-zimbify-core', exists)).toBe(
      'zimbify-core',
    )
  })

  it('recovers a non-hyphenated last segment', () => {
    expect(decodeClaudeProjectDir('-home-mburcheri-Development-ClaudeTotalRecall', exists)).toBe(
      'ClaudeTotalRecall',
    )
  })

  it('falls back to the last token when the encoded path no longer exists', () => {
    expect(decodeClaudeProjectDir('-home-ghost-Projects-whatever', () => false)).toBe('whatever')
  })
})

describe('scanClaudeProjects', () => {
  it('lists project dirs and flags memory vs empty', async () => {
    const base = await tmp()
    const root = join(base, 'projects')
    await mkdir(join(root, '-x-Development-ClaudeTotalRecall', 'memory'), { recursive: true })
    await mkdir(join(root, '-x-Development-empty-proj'), { recursive: true })
    await writeFile(join(root, '-x-Development-empty-proj', 'a.jsonl'), '{}')

    const res = await scanClaudeProjects(root, emptyConfig(), linuxAdapter(), 'this')
    const byDir = new Map(res.map((r) => [basename(r.dir), r]))

    const ready = byDir.get('-x-Development-ClaudeTotalRecall')!
    expect(ready.hasMemory).toBe(true)
    expect(ready.proposal.slots.map((s) => s.slot)).toEqual(['memory'])

    const empty = byDir.get('-x-Development-empty-proj')!
    expect(empty.hasMemory).toBe(false)
    expect(empty.proposal.slots).toEqual([])
    expect(empty.memoryPath).toBe(join(root, '-x-Development-empty-proj', 'memory'))
  })

  it('returns [] for a missing projects root (no throw)', async () => {
    const base = await tmp()
    expect(
      await scanClaudeProjects(join(base, 'nope'), emptyConfig(), linuxAdapter(), 'this'),
    ).toEqual([])
  })

  it('flags alreadySyncedHere when the memory path is already synced on this machine', async () => {
    const base = await tmp()
    const root = join(base, 'projects')
    const mem = join(root, '-x-app', 'memory')
    await mkdir(mem, { recursive: true })
    const config: Config = {
      version: 1,
      repo: { remote: 'r' },
      machines: {},
      projects: { other: { folders: { m: { this: mem } }, slotKinds: { m: 'dir' } } },
    }
    const res = await scanClaudeProjects(root, config, linuxAdapter(), 'this')
    expect(res[0].alreadySyncedHere).toBe(true)
  })

  it('dedupes suggested names that collide within the scan', async () => {
    const base = await tmp()
    const root = join(base, 'projects')
    // Both decode-fallback to the same last token "api".
    await mkdir(join(root, '-a-svc-api', 'memory'), { recursive: true })
    await mkdir(join(root, '-b-svc-api', 'memory'), { recursive: true })
    const res = await scanClaudeProjects(root, emptyConfig(), linuxAdapter(), 'this')
    const names = res.map((r) => r.suggestedName)
    expect(new Set(names).size).toBe(names.length) // all unique
  })
})
