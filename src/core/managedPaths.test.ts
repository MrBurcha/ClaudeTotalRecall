import { describe, expect, it } from 'vitest'
import {
  isExcludedRel,
  isManagedRepoPath,
  managedGitignoreLines,
  managedRepoPaths,
} from './managedPaths'

describe('Claude-managed paths (#135)', () => {
  it('maps the excluded skills cache to its repo root and an anchored .gitignore line', () => {
    expect(managedRepoPaths()).toEqual(['memories/user/skills/synced'])
    expect(managedGitignoreLines()).toEqual(['/memories/user/skills/synced/'])
  })

  it.each([
    'memories/user/skills/synced',
    'memories/user/skills/synced/org_acct/manifest.json',
    'memories/user/skills/synced/.bucket-org_acct',
    'memories\\user\\skills\\synced\\org_acct\\.last-complete-round',
  ])('flags paths inside the cache (%j)', (p) => {
    expect(isManagedRepoPath(p)).toBe(true)
  })

  it.each([
    'memories/user/skills/my-skill/SKILL.md',
    'memories/user/skills/my-skill/synced/notes.md',
    'memories/user/skills/synced-notes/SKILL.md',
    'memories/projects/demo/memory/synced/x.md',
    'memories/user/CLAUDE.md',
  ])('leaves user content alone (%j)', (p) => {
    expect(isManagedRepoPath(p)).toBe(false)
  })

  it('excludes by the FIRST segment of a slot-relative path only', () => {
    expect(isExcludedRel('synced', ['synced'])).toBe(true)
    expect(isExcludedRel('synced/org_acct/manifest.json', ['synced'])).toBe(true)
    expect(isExcludedRel('synced\\org_acct\\manifest.json', ['synced'])).toBe(true)
    expect(isExcludedRel('my-skill/synced/x.md', ['synced'])).toBe(false)
    expect(isExcludedRel('synced-notes/SKILL.md', ['synced'])).toBe(false)
    expect(isExcludedRel('synced/x', [])).toBe(false)
  })
})
