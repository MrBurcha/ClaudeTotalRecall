import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run } from './exec'
import { Git } from './git'
import { classifyCommit } from './history'

const PREFIX = 'Claude Total Recall: '

describe('classifyCommit', () => {
  it('classifies the current (machine-stamped) message forms', () => {
    expect(classifyCommit(`${PREFIX}outgoing on laptop`)).toEqual({
      type: 'outgoing',
      machineId: 'laptop',
    })
    expect(classifyCommit(`${PREFIX}register machine laptop`)).toEqual({
      type: 'register',
      machineId: 'laptop',
    })
    expect(classifyCommit(`${PREFIX}new project alpha`)).toEqual({
      type: 'new-project',
      project: 'alpha',
    })
    expect(classifyCommit(`${PREFIX}delete project alpha`)).toEqual({
      type: 'delete-project',
      project: 'alpha',
    })
    expect(classifyCommit(`${PREFIX}rename project alpha -> beta`)).toEqual({
      type: 'rename-project',
      from: 'alpha',
      to: 'beta',
    })
    expect(classifyCommit(`${PREFIX}set alpha/memory on laptop`)).toEqual({
      type: 'set-folder',
      project: 'alpha',
      slot: 'memory',
      machineId: 'laptop',
    })
    expect(classifyCommit(`${PREFIX}remove alpha/memory on laptop`)).toEqual({
      type: 'remove-folder',
      project: 'alpha',
      slot: 'memory',
      machineId: 'laptop',
    })
    expect(classifyCommit(`${PREFIX}pin agents on laptop`)).toEqual({
      type: 'pin',
      pin: 'agents',
      machineId: 'laptop',
    })
    expect(classifyCommit(`${PREFIX}unpin agents`)).toEqual({ type: 'unpin', pin: 'agents' })
    expect(classifyCommit(`${PREFIX}resolve conflicts`)).toEqual({ type: 'conflicts' })
  })

  it('maps the legacy pre-rename `gather` message to outgoing (no machine)', () => {
    // The real repo has pre-rename history; those must still classify as outgoing.
    expect(classifyCommit(`${PREFIX}gather`)).toEqual({ type: 'outgoing' })
    // Legacy `<proj>/<slot> on <id>` (no `set ` prefix) still reads as set-folder.
    expect(classifyCommit(`${PREFIX}alpha/memory on laptop`)).toEqual({
      type: 'set-folder',
      project: 'alpha',
      slot: 'memory',
      machineId: 'laptop',
    })
  })

  it('keyword forms win over the generic `<proj>/<slot> on <id>` catch', () => {
    // `remove …/… on …` must not be swallowed by the trailing set-folder regex.
    expect(classifyCommit(`${PREFIX}remove a/b on x`)?.type).toBe('remove-folder')
    expect(classifyCommit(`${PREFIX}pin p on x`)?.type).toBe('pin')
  })

  it('hides merges, external commits and the onboarding seed', () => {
    expect(classifyCommit('Merge pull request #7 from foo/bar')).toBeNull()
    expect(classifyCommit('chore: some external commit')).toBeNull()
    expect(classifyCommit(`${PREFIX}initial structure`)).toBeNull()
  })

  it('falls back to `other` for an unrecognized prefixed message', () => {
    expect(classifyCommit(`${PREFIX}something brand new`)).toEqual({ type: 'other' })
  })
})

describe('Git.log', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'claude-total-recall-hist-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function repoWithCommits(name: string): Promise<Git> {
    const dir = join(root, name)
    await run('git', ['init', '--initial-branch=main', dir])
    const g = new Git(dir)
    await g.config('user.email', 'test@claude-total-recall.local')
    await g.config('user.name', 'Claude Total Recall Test')
    await g.config('commit.gpgsign', 'false')
    return g
  }

  it('returns newest-first entries with a changed-file count', async () => {
    const g = await repoWithCommits('log-a')
    await writeFile(join(g.cwd, 'one.txt'), '1\n')
    await g.add()
    await g.commit('first')
    await writeFile(join(g.cwd, 'two.txt'), '2\n')
    await writeFile(join(g.cwd, 'three.txt'), '3\n')
    await g.add()
    await g.commit('second (two files)')

    const log = await g.log()
    expect(log).toHaveLength(2)
    // Newest first.
    expect(log[0].subject).toBe('second (two files)')
    expect(log[0].files).toBe(2)
    expect(log[1].subject).toBe('first')
    expect(log[1].files).toBe(1)
    expect(log[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect(Number.isNaN(Date.parse(log[0].at))).toBe(false)
  })

  it('returns [] for a repo with no commits', async () => {
    const g = await repoWithCommits('log-empty')
    expect(await g.log()).toEqual([])
  })
})
