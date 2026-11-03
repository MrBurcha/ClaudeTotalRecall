import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { run } from './exec'
import { Git } from './git'
import {
  completeConflictMerge,
  connectRepo,
  healManagedConflicts,
  history,
  registerMachine,
  resolveConflict,
  workingCopyDir,
} from './service'
import { incomingResolved, runSyncCycle } from './syncEngine'

// End-to-end coverage for #135 (Claude Code's skills cache must never sync, and the
// copy older versions pushed must be cleaned up without ever stalling sync) and for
// the post-resolution incoming that used to revert machine-side edits.

const CACHE_REPO = 'memories/user/skills/synced'
const BUCKET = 'org_acct'
const bases: string[] = []

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const r = await run('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args])
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

async function setup(): Promise<{ base: string; remote: string }> {
  const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-managed-'))
  bases.push(base)
  const remote = join(base, 'remote.git')
  await run('git', ['init', '--bare', '--initial-branch=main', remote])
  return { base, remote }
}

async function joinMachine(remote: string, name: string, home: string) {
  const a = createPlatformAdapter(process.platform, home)
  await connectRepo(remote, a)
  await registerMachine(a, name)
  return a
}

/** Files on the remote's main branch — what GitHub would show. */
async function remoteTree(remote: string): Promise<string[]> {
  const r = await run('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'])
  return r.stdout.split('\n').filter(Boolean)
}

async function remoteFile(remote: string, path: string): Promise<string> {
  const r = await run('git', ['--git-dir', remote, 'show', `main:${path}`])
  return r.stdout
}

/**
 * Commits Claude Code's cache into a working copy the way an OLDER app version did
 * (forcing past the new .gitignore entry) and pushes it.
 */
async function legacyCacheCommit(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await put(join(dir, CACHE_REPO, rel), content)
  }
  await git(dir, 'add', '-A', '-f')
  await git(dir, 'commit', '-m', 'Claude Total Recall: outgoing on old-version')
  await git(dir, 'push')
}

/** A plain clone standing in for a machine that still runs an older version. */
async function oldMachine(base: string, remote: string): Promise<string> {
  const dir = join(base, 'old-machine')
  await run('git', ['clone', remote, dir])
  return dir
}

const noCache = (paths: string[]): boolean => !paths.some((p) => p.startsWith(CACHE_REPO))

describe("Claude Code's managed skills cache (#135)", () => {
  it('purges the cache an older version left in the repo, git-ignores it, and does it once', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'm1\n')
    await put(join(home1, '.claude/skills/my-skill/SKILL.md'), 'mine\n')
    await put(join(home1, `.claude/skills/synced/${BUCKET}/manifest.json`), '{"m":1}')
    const a1 = await joinMachine(remote, 'm1', home1)
    await legacyCacheCommit(workingCopyDir(a1), {
      [`${BUCKET}/manifest.json`]: '{"old":1}',
      [`${BUCKET}/.last-complete-round`]: 'r0 cli',
      [`.bucket-${BUCKET}`]: '',
    })

    const out = await runSyncCycle(a1)
    expect(out.kind).toBe('synced')

    const tree = await remoteTree(remote)
    expect(noCache(tree)).toBe(true)
    expect(tree).toContain('memories/user/skills/my-skill/SKILL.md')
    expect(await remoteFile(remote, '.gitignore')).toContain(`/${CACHE_REPO}/`)
    // The machine's own cache is Claude Code's business: untouched.
    expect(
      await readFile(join(home1, `.claude/skills/synced/${BUCKET}/manifest.json`), 'utf8'),
    ).toBe('{"m":1}')

    // Idempotent: nothing left to clean, so the next cycle pushes nothing new.
    const head = await git(remote, 'rev-parse', 'main')
    expect((await runSyncCycle(a1)).kind).toBe('synced')
    expect(await git(remote, 'rev-parse', 'main')).toBe(head)

    // The activity feed shows the cleanup once, with its own entry type.
    expect((await history(a1)).filter((e) => e.type === 'cleanup')).toHaveLength(1)
  })

  it('cleans, in the same cycle, a cache an older machine pushes back (no local changes)', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'm1\n')
    const a1 = await joinMachine(remote, 'm1', home1)
    expect((await runSyncCycle(a1)).kind).toBe('synced')

    const old = await oldMachine(base, remote)
    await legacyCacheCommit(old, { [`${BUCKET}/manifest.json`]: '{"old":1}' })
    expect(noCache(await remoteTree(remote))).toBe(false)

    expect((await runSyncCycle(a1)).kind).toBe('synced') // else-branch: pull → purge → push
    expect(noCache(await remoteTree(remote))).toBe(true)

    // Once the purge reaches the older machine, its `git add -A` can't re-add the
    // cache any more: the path is ignored now.
    await git(old, 'pull', '--no-rebase')
    await put(join(old, CACHE_REPO, BUCKET, 'manifest.json'), '{"old":2}')
    await git(old, 'add', '-A')
    expect(await git(old, 'status', '--porcelain')).toBe('')
  })

  it('auto-resolves a modify/delete conflict on the cache instead of pausing sync', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'v0\n')
    const a1 = await joinMachine(remote, 'm1', home1)
    await legacyCacheCommit(workingCopyDir(a1), { [`${BUCKET}/.last-complete-round`]: 'r0 cli' })

    // An older machine refreshes the cache and pushes first…
    const old = await oldMachine(base, remote)
    await put(join(old, CACHE_REPO, BUCKET, '.last-complete-round'), 'r1 cli')
    await git(old, 'commit', '-am', 'Claude Total Recall: outgoing on old-version')
    await git(old, 'push')

    // …while m1 (new version) purges it and has a real change to push.
    await put(join(home1, '.claude/CLAUDE.md'), 'v1\n')
    const out = await runSyncCycle(a1)

    expect(out.kind).toBe('synced')
    expect(noCache(await remoteTree(remote))).toBe(true)
    expect(await remoteFile(remote, 'memories/user/CLAUDE.md')).toBe('v1\n')
    expect(await new Git(workingCopyDir(a1)).mergeInProgress()).toBe(false)
  })

  it('heals a merge an older version left stuck only on the cache, without clobbering local edits', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'v0\n')
    await put(join(home1, '.claude/commands/notes.md'), 'n0\n')
    const a1 = await joinMachine(remote, 'm1', home1)
    expect((await runSyncCycle(a1)).kind).toBe('synced')
    const wc1 = workingCopyDir(a1)
    await legacyCacheCommit(wc1, { [`${BUCKET}/.last-complete-round`]: 'r0 cli' })

    // Another machine pushes a real memory change plus a cache refresh…
    const old = await oldMachine(base, remote)
    await put(join(old, 'memories/user/CLAUDE.md'), 'from the other machine\n')
    await put(join(old, CACHE_REPO, BUCKET, '.last-complete-round'), 'r1 cli')
    await git(old, 'commit', '-am', 'Claude Total Recall: outgoing on old-version')
    await git(old, 'push')

    // …while m1, still on the old version, committed the cache file as deleted
    // (snapshotted mid-refresh) and pulled into a modify/delete conflict — the
    // exact state that froze a real machine for days.
    await git(wc1, 'rm', '-q', `${CACHE_REPO}/${BUCKET}/.last-complete-round`)
    await git(wc1, 'commit', '-m', 'Claude Total Recall: outgoing on m1')
    await run('git', ['-C', wc1, 'pull', '--no-rebase'])
    expect(await new Git(wc1).listConflicts()).toEqual([
      `${CACHE_REPO}/${BUCKET}/.last-complete-round`,
    ])

    // The user keeps working while sync is paused.
    await put(join(home1, '.claude/commands/notes.md'), 'n1 written during the freeze\n')

    const heal = await healManagedConflicts(a1)
    expect(heal).toEqual({ remaining: [], completed: true, pushed: true })
    await incomingResolved(a1)

    // The other machine's change lands; the freeze-time edit survives.
    expect(await readFile(join(home1, '.claude/CLAUDE.md'), 'utf8')).toBe(
      'from the other machine\n',
    )
    expect(await readFile(join(home1, '.claude/commands/notes.md'), 'utf8')).toBe(
      'n1 written during the freeze\n',
    )

    // The next regular cycle pushes that edit and finishes cleaning the repo.
    expect((await runSyncCycle(a1)).kind).toBe('synced')
    expect(await remoteFile(remote, 'memories/user/commands/notes.md')).toBe(
      'n1 written during the freeze\n',
    )
    expect(noCache(await remoteTree(remote))).toBe(true)
  })

  it('leaves real conflicts to the user and resolves only the cache ones', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'v0\n')
    const a1 = await joinMachine(remote, 'm1', home1)
    expect((await runSyncCycle(a1)).kind).toBe('synced')
    const wc1 = workingCopyDir(a1)
    await legacyCacheCommit(wc1, { [`${BUCKET}/.last-complete-round`]: 'r0 cli' })

    const old = await oldMachine(base, remote)
    await put(join(old, 'memories/user/CLAUDE.md'), 'theirs\n')
    await put(join(old, CACHE_REPO, BUCKET, '.last-complete-round'), 'r1 cli')
    await git(old, 'commit', '-am', 'Claude Total Recall: outgoing on old-version')
    await git(old, 'push')

    await put(join(wc1, 'memories/user/CLAUDE.md'), 'ours\n')
    await put(join(wc1, CACHE_REPO, BUCKET, '.last-complete-round'), 'r2 cli')
    await git(wc1, 'commit', '-am', 'Claude Total Recall: outgoing on m1')
    await run('git', ['-C', wc1, 'pull', '--no-rebase'])

    const heal = await healManagedConflicts(a1)
    expect(heal).toEqual({
      remaining: ['memories/user/CLAUDE.md'],
      completed: false,
      pushed: false,
    })
    expect(await new Git(wc1).listConflicts()).toEqual(['memories/user/CLAUDE.md'])
  })
})

describe('resolving a conflict keeps edits made while it was open (2026-11-03 data loss)', () => {
  it('lands the merge on the machine without reverting files edited during the freeze', async () => {
    const { base, remote } = await setup()
    const home1 = join(base, 'home1')
    await put(join(home1, '.claude/CLAUDE.md'), 'base\n')
    await put(join(home1, '.claude/commands/a.md'), 'a0\n')
    await put(join(home1, '.claude/commands/b.md'), 'b0\n')
    await put(join(home1, '.claude/settings.json'), JSON.stringify({ theme: 'dark' }))
    const a1 = await joinMachine(remote, 'm1', home1)
    expect((await runSyncCycle(a1)).kind).toBe('synced')

    const home2 = join(base, 'home2')
    const a2 = await joinMachine(remote, 'm2', home2)
    expect((await runSyncCycle(a2)).kind).toBe('synced') // bootstrap

    // m2 changes three things and pushes.
    await put(join(home2, '.claude/CLAUDE.md'), 'm2 version\n')
    await put(join(home2, '.claude/commands/a.md'), 'a from m2\n')
    await put(join(home2, '.claude/settings.json'), JSON.stringify({ theme: 'light' }))
    expect((await runSyncCycle(a2)).kind).toBe('synced')

    // m1 collides on CLAUDE.md: sync pauses on the conflict.
    await put(join(home1, '.claude/CLAUDE.md'), 'm1 version\n')
    const out = await runSyncCycle(a1)
    expect(out).toEqual({ kind: 'conflict', files: ['memories/user/CLAUDE.md'] })

    // Days go by: the user keeps editing on m1 (never committed — sync is paused).
    await put(join(home1, '.claude/commands/b.md'), 'b edited on m1 during the conflict\n')
    await put(join(home1, '.claude/commands/c.md'), 'new on m1\n')

    await resolveConflict(a1, 'memories/user/CLAUDE.md', 'remote')
    expect((await completeConflictMerge(a1)).pushed).toBe(true)
    await incomingResolved(a1)

    // What m2 changed lands on m1 (incl. settings.json, compared via its shared split)…
    expect(await readFile(join(home1, '.claude/CLAUDE.md'), 'utf8')).toBe('m2 version\n')
    expect(await readFile(join(home1, '.claude/commands/a.md'), 'utf8')).toBe('a from m2\n')
    expect(JSON.parse(await readFile(join(home1, '.claude/settings.json'), 'utf8'))).toEqual({
      theme: 'light',
    })
    // …and what m1 wrote during the freeze is still there (it used to be reverted).
    expect(await readFile(join(home1, '.claude/commands/b.md'), 'utf8')).toBe(
      'b edited on m1 during the conflict\n',
    )
    expect(await exists(join(home1, '.claude/commands/c.md'))).toBe(true)

    // The next cycles carry those edits over to m2.
    expect((await runSyncCycle(a1)).kind).toBe('synced')
    expect((await runSyncCycle(a2)).kind).toBe('synced')
    expect(await readFile(join(home2, '.claude/commands/b.md'), 'utf8')).toBe(
      'b edited on m1 during the conflict\n',
    )
    expect(await readFile(join(home2, '.claude/commands/c.md'), 'utf8')).toBe('new on m1\n')
    expect(await readFile(join(home2, '.claude/CLAUDE.md'), 'utf8')).toBe('m2 version\n')
  })
})
