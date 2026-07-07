import { describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import type { Config } from './types'
import {
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
    expect(byLogical.get('memories/user/CLAUDE.md')?.realPath).toBe(
      `${HOME}/.claude/CLAUDE.md`,
    )
    expect(byLogical.get('memories/user/settings.json')?.realPath).toBe(
      `${HOME}/.claude/settings.json`,
    )
    expect(byLogical.get('memories/user/commands')?.realPath).toBe(
      `${HOME}/.claude/commands`,
    )
  })
})

describe('projectSlotPath', () => {
  it('returns the literal path for a mapped machineId', () => {
    const config = sampleConfig()
    expect(projectSlotPath(config, 'demo', 'memory', 'laptop')).toBe(
      '/home/me/code/demo/.claude',
    )
    expect(projectSlotPath(config, 'demo', 'memory', 'desktop')).toBe(
      '/Users/me/code/demo/.claude',
    )
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
    expect(projectSlotLogicalPath('x', 'memory')).toBe(
      'memories/projects/x/memory',
    )
    expect(projectSlotLogicalPath('demo', 'docs')).toBe(
      'memories/projects/demo/docs',
    )
  })
})
