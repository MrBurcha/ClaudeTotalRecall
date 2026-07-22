import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeMerge, resolveConflictFile } from './conflict'
import { run } from './exec'
import { Git } from './git'

let root: string

async function configUser(g: Git): Promise<void> {
  await g.config('user.email', 'test@claude-total-recall.local')
  await g.config('user.name', 'Claude Total Recall Test')
  await g.config('commit.gpgsign', 'false')
}

/** Creates a bare remote seeded with a.txt on main. Returns the remote path. */
async function freshRemote(name: string): Promise<string> {
  const remote = join(root, `${name}.git`)
  await run('git', ['init', '--bare', '--initial-branch=main', remote])
  const seed = join(root, `${name}-seed`)
  const g = await Git.clone(remote, seed)
  await configUser(g)
  await writeFile(join(seed, 'a.txt'), 'hello\n')
  await g.add()
  await g.commit('init')
  await g.push(['-u', 'origin', 'main'])
  return remote
}

async function cloneConfigured(remote: string, dir: string): Promise<Git> {
  const g = await Git.clone(remote, dir)
  await configUser(g)
  return g
}

// Force core.autocrlf=false for EVERY git invocation in this file — including the
// clone-time checkout — via GIT_CONFIG_* env vars (run() forwards process.env to git).
// Git for Windows defaults autocrlf to true, so without this a clone materializes the
// seeded '…\n' files as CRLF; they then read as "modified" against the LF index,
// producing false-dirty trees and phantom merge conflicts that break these byte-exact
// integration tests. Setting it via local `git config` (post-clone) is too late — the
// checkout already happened. Restored in afterAll so other files are unaffected.
const savedGitConfigEnv: Record<string, string | undefined> = {}
const GIT_CONFIG_ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']

beforeAll(async () => {
  for (const k of GIT_CONFIG_ENV_KEYS) savedGitConfigEnv[k] = process.env[k]
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf'
  process.env.GIT_CONFIG_VALUE_0 = 'false'
  root = await mkdtemp(join(tmpdir(), 'claude-total-recall-git-'))
})
afterAll(async () => {
  for (const k of GIT_CONFIG_ENV_KEYS) {
    const v = savedGitConfigEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(root, { recursive: true, force: true })
})

describe('Git status / commit', () => {
  it('reports branch, ahead/behind and dirty; commit increments ahead', async () => {
    const remote = await freshRemote('status')
    const a = await cloneConfigured(remote, join(root, 'status-A'))

    let st = await a.status()
    expect(st.branch).toBe('main')
    expect(st).toMatchObject({ ahead: 0, behind: 0, dirty: false, conflicted: [] })

    await writeFile(join(a.cwd, 'b.txt'), 'b\n')
    expect(await a.isDirty()).toBe(true)
    await a.add()
    expect((await a.commit('add b')).committed).toBe(true)

    st = await a.status()
    expect(st.ahead).toBe(1)

    expect((await a.push()).ok).toBe(true)
    st = await a.status()
    expect(st.ahead).toBe(0)
  })

  it('commit returns committed:false when the working tree is clean', async () => {
    const remote = await freshRemote('noop')
    const a = await cloneConfigured(remote, join(root, 'noop-A'))
    expect((await a.commit('nada')).committed).toBe(false)
  })
})

describe('revParse / logRange', () => {
  it('revParse resolves HEAD to a 40-hex hash and returns null for a bogus ref', async () => {
    const remote = await freshRemote('rev')
    const a = await cloneConfigured(remote, join(root, 'rev-A'))
    const head = await a.revParse('HEAD')
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(await a.revParse('no-such-ref')).toBeNull()
  })

  it('logRange returns commits in (from, to], excluding the base', async () => {
    const remote = await freshRemote('range')
    const a = await cloneConfigured(remote, join(root, 'range-A'))
    const base = await a.revParse('HEAD')

    await writeFile(join(a.cwd, 'b.txt'), 'b\n')
    await a.add()
    await a.commit('second commit')
    const head = await a.revParse('HEAD')

    const range = await a.logRange(base as string, head as string)
    expect(range).toHaveLength(1) // the base commit is excluded
    expect(range[0].subject).toBe('second commit')
    expect(range[0].changes).toEqual([{ status: 'added', path: 'b.txt' }])

    // An empty range (from === to) yields nothing.
    expect(await a.logRange(head as string, head as string)).toEqual([])
  })
})

describe('push rejected → pull(merge) → retry', () => {
  it('B is rejected, merges without conflict and retries', async () => {
    const remote = await freshRemote('reject')
    const a = await cloneConfigured(remote, join(root, 'reject-A'))
    const b = await cloneConfigured(remote, join(root, 'reject-B'))

    await writeFile(join(a.cwd, 'a.txt'), 'from A\n')
    await a.add()
    await a.commit('A edita a.txt')
    expect((await a.push()).ok).toBe(true)

    // B touches a different file → no real conflict
    await writeFile(join(b.cwd, 'c.txt'), 'from B\n')
    await b.add()
    await b.commit('B agrega c.txt')

    const rejected = await b.push()
    expect(rejected.ok).toBe(false)
    expect(rejected.rejected).toBe(true)

    const pulled = await b.pull()
    expect(pulled.ok).toBe(true)
    expect(pulled.conflicted).toEqual([])

    expect((await b.push()).ok).toBe(true)
  })
})

describe('conflict resolution (merge: ours=local, theirs=remote)', () => {
  it('keeping REMOTE leaves the repo version (theirs)', async () => {
    const remote = await freshRemote('conf-remote')
    const a = await cloneConfigured(remote, join(root, 'conf-remote-A'))
    const b = await cloneConfigured(remote, join(root, 'conf-remote-B'))

    await writeFile(join(a.cwd, 'a.txt'), 'A version\n')
    await a.add()
    await a.commit('A')
    await a.push()

    await writeFile(join(b.cwd, 'a.txt'), 'B version\n')
    await b.add()
    await b.commit('B')

    const pulled = await b.pull()
    expect(pulled.ok).toBe(false)
    expect(pulled.conflicted).toContain('a.txt')

    await resolveConflictFile(b, 'a.txt', 'remote')
    await completeMerge(b, 'merge quedándome con remoto')

    expect(await readFile(join(b.cwd, 'a.txt'), 'utf8')).toBe('A version\n')
    expect((await b.push()).ok).toBe(true)
  })

  it('keeping LOCAL leaves your version (ours)', async () => {
    const remote = await freshRemote('conf-local')
    const a = await cloneConfigured(remote, join(root, 'conf-local-A'))
    const b = await cloneConfigured(remote, join(root, 'conf-local-B'))

    await writeFile(join(a.cwd, 'a.txt'), 'A version\n')
    await a.add()
    await a.commit('A')
    await a.push()

    await writeFile(join(b.cwd, 'a.txt'), 'B version\n')
    await b.add()
    await b.commit('B')

    const pulled = await b.pull()
    expect(pulled.ok).toBe(false)

    await resolveConflictFile(b, 'a.txt', 'local')
    await completeMerge(b, 'merge quedándome con local')

    expect(await readFile(join(b.cwd, 'a.txt'), 'utf8')).toBe('B version\n')
  })
})
