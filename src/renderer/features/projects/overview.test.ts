import { describe, expect, it } from 'vitest'
import type { Config } from '../../../core/types'
import { buildOverview, filterOverview, homeRelative, overviewStats } from './overview'

const config: Config = {
  version: 1,
  repo: { remote: 'git@x' },
  machines: {
    mac: { os: 'macos', hostname: 'mac', home: '/Users/me' },
    win: { os: 'windows', hostname: 'win', home: 'C:\\Users\\Me' },
    linux: { os: 'linux', hostname: 'box', home: '/home/me' },
  },
  projects: {
    zeta: {
      folders: {
        // same home-relative path on every machine
        notes: {
          mac: '/Users/me/zeta/NOTES.md',
          win: 'c:\\users\\me\\zeta\\NOTES.md',
          linux: '/home/me/zeta/NOTES.md',
        },
        // two agree, one is off
        memory: {
          mac: '/Users/me/.claude/projects/-zeta/memory',
          linux: '/home/me/.claude/projects/-zeta/memory',
          win: 'C:\\Users\\Me\\.claude\\projects\\C--zeta\\memory',
        },
      },
      slotKinds: { notes: 'file' },
    },
    alpha: {
      folders: {
        // only two machines, and they disagree → no majority, both flagged
        memory: { mac: '/Users/me/a', linux: '/home/me/b' },
      },
    },
    empty: { folders: {} },
  },
  pinnedFiles: {
    'CLAUDE.local.md': { mac: '/Users/me/CLAUDE.local.md', ghost: '/old/CLAUDE.local.md' },
  },
}

describe('homeRelative', () => {
  it("replaces the machine's home with ~ and normalizes separators", () => {
    expect(homeRelative('/Users/me/x/y.md', config.machines.mac)).toBe('~/x/y.md')
    expect(homeRelative('C:\\Users\\Me\\x', config.machines.win)).toBe('~/x')
    expect(homeRelative('/Users/me', config.machines.mac)).toBe('~')
  })

  it('matches the home case-insensitively only on Windows', () => {
    expect(homeRelative('c:\\USERS\\me\\x', config.machines.win)).toBe('~/x')
    expect(homeRelative('/users/me/x', config.machines.mac)).toBe('/users/me/x')
  })

  it('needs a separator boundary, and leaves paths outside the home alone', () => {
    expect(homeRelative('/Users/meow/x', config.machines.mac)).toBe('/Users/meow/x')
    expect(homeRelative('D:\\data\\x', config.machines.win)).toBe('D:/data/x')
    expect(homeRelative('C:\\x', undefined)).toBe('C:/x')
    expect(homeRelative('/x', { os: 'linux', hostname: 'h', home: '/' })).toBe('/x')
  })
})

describe('buildOverview', () => {
  const sections = buildOverview(config, 'win')
  const section = (id: string) => sections.find((s) => s.id === id)!
  const entry = (id: string, name: string) => section(id).entries.find((e) => e.name === name)!

  it('orders user level, pinned, then projects alphabetically', () => {
    expect(sections.map((s) => s.id)).toEqual([
      'user',
      'pinned',
      'project:alpha',
      'project:empty',
      'project:zeta',
    ])
  })

  it('lists the fixed user-level items with one shared path', () => {
    expect(section('user').entries.map((e) => e.name)).toEqual([
      'CLAUDE.md',
      'commands',
      'agents',
      'skills',
      'settings.json',
    ])
    expect(entry('user', 'skills')).toMatchObject({
      key: 'memories/user/skills',
      kind: 'dir',
      sharedPath: '~/.claude/skills',
      cells: [],
      missing: 0,
      differs: false,
    })
  })

  it('has a cell for every machine (this one first), flagging the unmapped ones', () => {
    const pin = entry('pinned', 'CLAUDE.local.md')
    expect(pin.key).toBe('memories/pinned/CLAUDE.local.md')
    expect(pin.cells.map((c) => [c.machineId, c.status])).toEqual([
      ['win', 'missing'],
      ['mac', 'mapped'],
      ['linux', 'missing'],
      ['ghost', 'mapped'],
    ])
    // only registered machines count as gaps; an unregistered id (no known home)
    // isn't compared, so its odd path doesn't make the entry "differ"
    expect(pin.missing).toBe(2)
    expect(pin.differs).toBe(false)
  })

  it('carries the slot kind and repo path of project entries', () => {
    expect(entry('project:zeta', 'notes')).toMatchObject({
      key: 'memories/projects/zeta/notes',
      kind: 'file',
      differs: false,
      missing: 0,
    })
    expect(entry('project:zeta', 'memory').kind).toBe('dir')
    expect(section('project:empty').entries).toEqual([])
  })

  it('flags only the machine off the common home-relative path', () => {
    const memory = entry('project:zeta', 'memory')
    expect(memory.differs).toBe(true)
    expect(memory.cells.map((c) => [c.machineId, c.status])).toEqual([
      ['win', 'differs'],
      ['mac', 'mapped'],
      ['linux', 'mapped'],
    ])
  })

  it('flags every mapped machine when there is no single common path', () => {
    const memory = entry('project:alpha', 'memory')
    expect(memory.differs).toBe(true)
    expect(memory.cells.map((c) => c.status)).toEqual(['missing', 'differs', 'differs'])
  })

  it('works without pinnedFiles / slotKinds (older configs)', () => {
    const bare = buildOverview({ ...config, pinnedFiles: undefined }, null)
    expect(bare.find((s) => s.id === 'pinned')?.entries).toEqual([])
  })
})

describe('filterOverview', () => {
  const sections = buildOverview(config, 'win')
  const ids = (q: string) =>
    filterOverview(sections, q).map((s) => [s.id, s.entries.map((e) => e.name)])

  it('returns everything for an empty query', () => {
    expect(filterOverview(sections, '  ')).toBe(sections)
  })

  it('matches names, repo paths, paths and machine ids, case-insensitively', () => {
    expect(ids('notes.md')).toEqual([['project:zeta', ['notes']]])
    expect(ids('GHOST')).toEqual([['pinned', ['CLAUDE.local.md']]])
    expect(ids('memories/user/agents')).toEqual([['user', ['agents']]])
    expect(ids('C--zeta')).toEqual([['project:zeta', ['memory']]])
  })

  it('requires every word, and a project name matches all its entries', () => {
    expect(ids('zeta memory')).toEqual([['project:zeta', ['memory']]])
    expect(ids('zeta')).toEqual([['project:zeta', ['memory', 'notes']]])
  })

  it('keeps an empty project whose name matches, drops sections with no hit', () => {
    expect(ids('empt')).toEqual([['project:empty', []]])
    expect(ids('nothing-like-this')).toEqual([])
  })
})

describe('overviewStats', () => {
  it('counts entries, gaps and differing paths', () => {
    expect(overviewStats(buildOverview(config, 'win'))).toEqual({
      entries: 9,
      withGaps: 2,
      withDiffs: 2,
    })
  })
})
