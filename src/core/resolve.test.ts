import { describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import type { Config } from './types'
import {
  machinePathForLogical,
  machineSyncedPaths,
  pathsCollide,
  projectSlotLogicalPath,
  projectSlotPath,
  projectSlots,
  userLevelItems,
} from './resolve'

const HOME = '/tmp/claude-total-recall-home'

function adapter() {
  return createPlatformAdapter('linux', HOME)
}

function sampleConfig(): Config {
  return {
    version: 1,
    repo: { remote: 'https://example.com/repo.git' },
    machines: {
      laptop: { os: 'linux', hostname: 'laptop', home: '/home/me' },
      desktop: { os: 'macos', hostname: 'desktop', home: '/Users/me' },
    },
    projects: {
      demo: {
        folders: {
          memory: {
            laptop: '/home/me/code/demo/.claude',
            desktop: '/Users/me/code/demo/.claude',
          },
          docs: {
            laptop: '/home/me/code/demo/docs',
          },
        },
      },
    },
  }
}

describe('userLevelItems', () => {
  it('returns the 5 fixed user-level items with correct logical paths', () => {
    const items = userLevelItems(adapter())
    expect(items).toHaveLength(5)

    const byLogical = new Map(items.map((i) => [i.logicalPath, i]))
    expect(byLogical.get('memories/user/CLAUDE.md')?.kind).toBe('file')
    expect(byLogical.get('memories/user/commands')?.kind).toBe('dir')
    expect(byLogical.get('memories/user/agents')?.kind).toBe('dir')
    expect(byLogical.get('memories/user/skills')?.kind).toBe('dir')
    expect(byLogical.get('memories/user/settings.json')?.kind).toBe('file')
  })

  it('places every realPath inside ~/.claude', () => {
    const a = adapter()
    const items = userLevelItems(a)
    for (const item of items) {
      expect(item.realPath.startsWith(a.claudeHome())).toBe(true)
    }
    const byLogical = new Map(items.map((i) => [i.logicalPath, i]))
    expect(byLogical.get('memories/user/CLAUDE.md')?.realPath).toBe(`${HOME}/.claude/CLAUDE.md`)
    expect(byLogical.get('memories/user/settings.json')?.realPath).toBe(
      `${HOME}/.claude/settings.json`,
    )
    expect(byLogical.get('memories/user/commands')?.realPath).toBe(`${HOME}/.claude/commands`)
  })
})

describe('projectSlotPath', () => {
  it('returns the literal path for a mapped machineId', () => {
    const config = sampleConfig()
    expect(projectSlotPath(config, 'demo', 'memory', 'laptop')).toBe('/home/me/code/demo/.claude')
    expect(projectSlotPath(config, 'demo', 'memory', 'desktop')).toBe('/Users/me/code/demo/.claude')
  })

  it('returns null for an unmapped machineId', () => {
    const config = sampleConfig()
    expect(projectSlotPath(config, 'demo', 'docs', 'desktop')).toBeNull()
  })

  it('returns null for missing project or slot', () => {
    const config = sampleConfig()
    expect(projectSlotPath(config, 'nope', 'memory', 'laptop')).toBeNull()
    expect(projectSlotPath(config, 'demo', 'nope', 'laptop')).toBeNull()
  })
})

describe('projectSlots', () => {
  it('lists the slot names of a project', () => {
    const config = sampleConfig()
    expect(projectSlots(config, 'demo').sort()).toEqual(['docs', 'memory'])
  })

  it('returns [] for a missing project', () => {
    const config = sampleConfig()
    expect(projectSlots(config, 'nope')).toEqual([])
  })
})

describe('projectSlotLogicalPath', () => {
  it('builds memories/projects/<project>/<slot>', () => {
    expect(projectSlotLogicalPath('x', 'memory')).toBe('memories/projects/x/memory')
    expect(projectSlotLogicalPath('demo', 'docs')).toBe('memories/projects/demo/docs')
  })
})

describe('pathsCollide', () => {
  it('is true for equal, ancestor or descendant paths; false for siblings', () => {
    expect(pathsCollide('/tmp/a', '/tmp/a')).toBe(true)
    expect(pathsCollide('/tmp/a', '/tmp/a/sub')).toBe(true)
    expect(pathsCollide('/tmp/a/sub', '/tmp/a')).toBe(true)
    expect(pathsCollide('/tmp/a', '/tmp/b')).toBe(false)
  })

  it('respects the separator boundary (no false prefix match)', () => {
    expect(pathsCollide('/tmp/ab', '/tmp/abc')).toBe(false)
  })

  it('normalizes trailing slash and .. before comparing', () => {
    expect(pathsCollide('/tmp/a/', '/tmp/a')).toBe(true)
    expect(pathsCollide('/tmp/a/../a/sub', '/tmp/a')).toBe(true)
  })
})

describe('machineSyncedPaths', () => {
  it("collects this machine's project folders plus the user-level dir roots", () => {
    const set = machineSyncedPaths(sampleConfig(), adapter(), 'laptop').map((p) => p.path)
    expect(set).toContain('/home/me/code/demo/.claude')
    expect(set).toContain('/home/me/code/demo/docs')
    expect(set).toContain(`${HOME}/.claude/commands`)
    expect(set).toContain(`${HOME}/.claude/agents`)
    expect(set).toContain(`${HOME}/.claude/skills`)
    // user-level FILE roots (CLAUDE.md, settings.json) are not folders → excluded
    expect(set).not.toContain(`${HOME}/.claude/CLAUDE.md`)
  })

  it('excludes the (project, slot) being edited', () => {
    const set = machineSyncedPaths(sampleConfig(), adapter(), 'laptop', {
      project: 'demo',
      slot: 'memory',
    }).map((p) => p.path)
    expect(set).not.toContain('/home/me/code/demo/.claude')
    expect(set).toContain('/home/me/code/demo/docs')
  })

  it('only considers the given machine', () => {
    const set = machineSyncedPaths(sampleConfig(), adapter(), 'desktop').map((p) => p.path)
    expect(set).toContain('/Users/me/code/demo/.claude') // desktop's memory path
    expect(set).not.toContain('/home/me/code/demo/docs') // laptop-only
  })
})

describe('machinePathForLogical', () => {
  const a = adapter()

  it('resolves user-level files under ~/.claude, with and without a rest path', () => {
    const c = sampleConfig()
    expect(machinePathForLogical('memories/user/CLAUDE.md', c, 'laptop', a)).toBe(
      `${HOME}/.claude/CLAUDE.md`,
    )
    expect(machinePathForLogical('memories/user/commands/deploy.md', c, 'laptop', a)).toBe(
      `${HOME}/.claude/commands/deploy.md`,
    )
  })

  it('joins a dir project slot with the rest of the path', () => {
    expect(
      machinePathForLogical('memories/projects/demo/memory/notes.md', sampleConfig(), 'laptop', a),
    ).toBe('/home/me/code/demo/.claude/notes.md')
  })

  it('resolves a file project slot to the configured path itself', () => {
    const c: Config = {
      version: 1,
      repo: { remote: 'r' },
      machines: {},
      projects: {
        p: { folders: { env: { laptop: '/home/me/app/.env' } }, slotKinds: { env: 'file' } },
      },
    }
    expect(machinePathForLogical('memories/projects/p/env', c, 'laptop', a)).toBe(
      '/home/me/app/.env',
    )
  })

  it('resolves a pinned file to its configured path', () => {
    const c: Config = {
      version: 1,
      repo: { remote: 'r' },
      machines: {},
      projects: {},
      pinnedFiles: { 'prod-env': { laptop: '/home/me/secrets/.env' } },
    }
    expect(machinePathForLogical('memories/pinned/prod-env', c, 'laptop', a)).toBe(
      '/home/me/secrets/.env',
    )
  })

  it('returns null when not mapped on this machine or unrecognized', () => {
    const c = sampleConfig()
    expect(machinePathForLogical('memories/projects/demo/docs/x', c, 'desktop', a)).toBeNull()
    expect(machinePathForLogical('memories/projects/nope/memory/x', c, 'laptop', a)).toBeNull()
    expect(machinePathForLogical('memories/pinned/none', c, 'laptop', a)).toBeNull()
    expect(machinePathForLogical('claudetr.json', c, 'laptop', a)).toBeNull()
  })
})
