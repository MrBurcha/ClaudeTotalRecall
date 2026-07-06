import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeMerge, resolveConflictFile } from './conflict'
import { run } from './exec'
import { Git } from './git'

let root: string

async function configUser(g: Git): Promise<void> {
  await g.config('user.email', 'test@claudetr.local')
  await g.config('user.name', 'ClaudeTR Test')
  await g.config('commit.gpgsign', 'false')
}

/** Crea un remote bare seedeado con a.txt en main. Devuelve el path del remote. */
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

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'claudetr-git-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Git status / commit', () => {
  it('reporta branch, ahead/behind y dirty; commit sube ahead', async () => {
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

  it('commit devuelve committed:false cuando el working tree está limpio', async () => {
    const remote = await freshRemote('noop')
    const a = await cloneConfigured(remote, join(root, 'noop-A'))
    expect((await a.commit('nada')).committed).toBe(false)
  })
})

describe('push rechazado → pull(merge) → retry', () => {
  it('B es rechazado, mergea sin conflicto y reintenta', async () => {
    const remote = await freshRemote('reject')
    const a = await cloneConfigured(remote, join(root, 'reject-A'))
    const b = await cloneConfigured(remote, join(root, 'reject-B'))

    await writeFile(join(a.cwd, 'a.txt'), 'from A\n')
    await a.add()
    await a.commit('A edita a.txt')
    expect((await a.push()).ok).toBe(true)

    // B toca un archivo distinto → no hay conflicto real
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

describe('resolución de conflictos (merge: ours=local, theirs=remoto)', () => {
  it('quedate con REMOTO deja la versión del repo (theirs)', async () => {
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

  it('quedate con LOCAL deja tu versión (ours)', async () => {
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
