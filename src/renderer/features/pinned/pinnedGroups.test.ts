import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { Config } from '../../../core/types'
import {
  baseName,
  buildPinnedTree,
  entryTarget,
  findPinnedEntry,
  groupId,
  machineOrder,
  machinePathRows,
  pinnedLogicalPath,
  previewFileName,
  suggestName,
  takenNames,
  validateFileName,
} from './pinnedGroups'

// Identity t: assert on stable keys, not text.
const t = ((key: string) => key) as unknown as TFunction

const config: Config = {
  version: 1,
  repo: { remote: 'git@x' },
  machines: {
    mac: { os: 'macos', hostname: 'mac', home: '/Users/me' },
    win: { os: 'windows', hostname: 'win', home: 'C:\\Users\\me' },
  },
  projects: {
    zeta: {
      folders: {
        memory: { mac: '/Users/me/.claude/projects/-zeta/memory' },
        'AGENTS.md': { mac: '/Users/me/zeta/AGENTS.md', win: 'C:\\code\\zeta\\AGENTS.md' },
        rules: { win: 'C:\\code\\zeta\\RULES.md' },
      },
      slotKinds: { memory: 'dir', 'AGENTS.md': 'file', rules: 'file' },
    },
    alpha: { folders: { memory: { mac: '/Users/me/.claude/projects/-alpha/memory' } } },
  },
  pinnedFiles: {
    'notes.md': { mac: '/Users/me/notes.md' },
    'CLAUDE.local.md': { win: 'C:\\Users\\me\\CLAUDE.local.md', ghost: '/old/CLAUDE.local.md' },
  },
}

describe('buildPinnedTree', () => {
  const groups = buildPinnedTree(config)

  it('puts General first, then every project alphabetically', () => {
    expect(groups.map((g) => g.id)).toEqual(['general', 'project:alpha', 'project:zeta'])
  })

  it('General holds the global pinned files, sorted, keyed by their repo path', () => {
    expect(groups[0].entries.map((e) => e.key)).toEqual([
      'memories/pinned/CLAUDE.local.md',
      'memories/pinned/notes.md',
    ])
    expect(groups[0].entries[1]).toMatchObject({ scope: 'general', name: 'notes.md' })
  })

  it('a project group holds only its file-kind slots (folder slots stay in Projects)', () => {
    const zeta = groups.find((g) => g.id === 'project:zeta')
    expect(zeta?.entries.map((e) => e.name)).toEqual(['AGENTS.md', 'rules'])
    expect(zeta?.entries[0]).toMatchObject({
      key: 'memories/projects/zeta/AGENTS.md',
      scope: 'project',
      project: 'zeta',
    })
  })

  it('keeps projects with no file source as empty groups (a place to add one)', () => {
    expect(groups.find((g) => g.id === 'project:alpha')?.entries).toEqual([])
  })

  it('works without pinnedFiles / slotKinds (older configs)', () => {
    const bare: Config = { ...config, pinnedFiles: undefined }
    expect(buildPinnedTree(bare)[0].entries).toEqual([])
  })
})

describe('findPinnedEntry', () => {
  const groups = buildPinnedTree(config)
  it('finds an entry by key in any group, null otherwise', () => {
    expect(findPinnedEntry(groups, 'memories/projects/zeta/rules')?.name).toBe('rules')
    expect(findPinnedEntry(groups, 'memories/projects/zeta/memory')).toBeNull()
    expect(findPinnedEntry(groups, null)).toBeNull()
  })
})

describe('paths and ids', () => {
  it('builds the repo path and group id of a target', () => {
    expect(pinnedLogicalPath({ scope: 'general' }, 'a.md')).toBe('memories/pinned/a.md')
    expect(pinnedLogicalPath({ scope: 'project', project: 'p' }, 'a.md')).toBe(
      'memories/projects/p/a.md',
    )
    expect(groupId({ scope: 'general' })).toBe('general')
    const [general, , zeta] = buildPinnedTree(config)
    expect(entryTarget(general.entries[0])).toEqual({ scope: 'general' })
    expect(entryTarget(zeta.entries[0])).toEqual({ scope: 'project', project: 'zeta' })
    expect(groupId({ scope: 'project', project: 'p' })).toBe('project:p')
  })
})

describe('machine rows', () => {
  it('orders this machine first, then registered machines, then unregistered ids', () => {
    expect(machineOrder(config, 'win', [{ ghost: '/x' }])).toEqual(['win', 'mac', 'ghost'])
    expect(machineOrder(config, null)).toEqual(['mac', 'win'])
  })

  it('lists every machine with its path or null, flagging the current one', () => {
    const rows = machinePathRows(config, config.pinnedFiles!['CLAUDE.local.md'], 'mac')
    expect(rows).toEqual([
      { machineId: 'mac', path: null, current: true },
      { machineId: 'win', path: 'C:\\Users\\me\\CLAUDE.local.md', current: false },
      { machineId: 'ghost', path: '/old/CLAUDE.local.md', current: false },
    ])
  })
})

describe('new-file names', () => {
  it('a project reserves every slot name, folders included', () => {
    expect(takenNames(config, { scope: 'project', project: 'zeta' })).toEqual([
      'memory',
      'AGENTS.md',
      'rules',
    ])
    expect(takenNames(config, { scope: 'project', project: 'nope' })).toEqual([])
    expect(takenNames(config, { scope: 'general' })).toEqual(['notes.md', 'CLAUDE.local.md'])
  })

  it('validates empty, unsafe and taken (case-insensitive) names', () => {
    expect(validateFileName('  ', [], t)).toBe('pinned.nameRequired')
    expect(validateFileName('a/b', [], t)).toBe('pinned.nameInvalid')
    expect(validateFileName('..', [], t)).toBe('pinned.nameInvalid')
    expect(validateFileName('Memory', ['memory'], t)).toBe('pinned.nameTaken')
    expect(validateFileName(' ok.md ', ['memory'], t)).toBeNull()
  })

  it('suggests a safe name from a picked path', () => {
    expect(suggestName('/Users/me/CLAUDE.md')).toBe('CLAUDE.md')
    expect(suggestName('C:\\Users\\me\\My Notes (v2).md')).toBe('My-Notes-v2-.md')
    expect(suggestName('/x/...')).toBe('')
    expect(suggestName('')).toBe('')
  })

  it('baseName handles both separators and trailing slashes', () => {
    expect(baseName('C:\\a\\b.txt')).toBe('b.txt')
    expect(baseName('/a/b/')).toBe('b')
  })
})

describe('previewFileName', () => {
  const zeta = buildPinnedTree(config).find((g) => g.id === 'project:zeta')!
  const rules = zeta.entries.find((e) => e.name === 'rules')!
  const agents = zeta.entries.find((e) => e.name === 'AGENTS.md')!

  it("prefers this machine's path basename, then any machine's, then the name", () => {
    expect(previewFileName(agents, 'mac')).toBe('AGENTS.md')
    expect(previewFileName(rules, 'mac')).toBe('RULES.md')
    expect(previewFileName({ ...rules, byMachine: {} }, 'mac')).toBe('rules')
  })
})
