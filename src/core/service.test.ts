import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { run } from './exec'
import { Git } from './git'
import { loadConfig } from './config'
import {
  buildVerbPlan,
  configPath,
  connectRepo,
  createProject,
  deleteProject,
  pullRepo,
  registerMachine,
  removeProjectFolder,
  repoStatus,
  setProjectFolder,
  syncGather,
  syncScatter,
  workingCopyDir,
} from './service'

const bases: string[] = []

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function newBase(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-svc-'))
  bases.push(base)
  return base
}

async function bareRemote(base: string, name = 'remote'): Promise<string> {
  const remote = join(base, `${name}.git`)
  await run('git', ['init', '--bare', '--initial-branch=main', remote])
  return remote
}

function adapterFor(home: string) {
  return createPlatformAdapter(process.platform, home)
}

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

describe('connectRepo', () => {
  it('initializes the structure in an empty repo and does not re-initialize one with content', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    const a1 = adapterFor(join(base, 'home1'))
    const r1 = await connectRepo(remote, a1)
    expect(r1.initialized).toBe(true)
    expect(await exists(configPath(a1))).toBe(true)
    expect(await exists(join(workingCopyDir(a1), 'memories/user/commands/.gitkeep'))).toBe(true)

    // Another machine clones the already-initialized repo.
    const a2 = adapterFor(join(base, 'home2'))
    const r2 = await connectRepo(remote, a2)
    expect(r2.initialized).toBe(false)
    expect(await exists(configPath(a2))).toBe(true)
  })
})

describe('registerMachine', () => {
  it('is idempotent and does not lose records of different machines', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    const a1 = adapterFor(join(base, 'home1'))
    await connectRepo(remote, a1)
    const a2 = adapterFor(join(base, 'home2'))
    await connectRepo(remote, a2)

    const reg1 = await registerMachine(a1, 'machine-one')
    expect(reg1.machineId).toBe('machine-one')
    expect(reg1.alreadyRegistered).toBe(false)

    // Re-registering the same one is idempotent.
    const reg1b = await registerMachine(a1, 'machine-one')
    expect(reg1b.alreadyRegistered).toBe(true)

    // a2 registers another machine; the fetch+reset+reapply does not clobber machine-one.
    const reg2 = await registerMachine(a2, 'machine-two')
    expect(reg2.machineId).toBe('machine-two')

    // The remote has both.
    const g1 = new Git(workingCopyDir(a1))
    await g1.fetch()
    await g1.resetHard('origin/main')
    const config = await loadConfig(configPath(a1))
    expect(Object.keys(config.machines).sort()).toEqual(['machine-one', 'machine-two'])

    // The local.json was written with the identity.
    expect(await exists(join(a1.configHome(), 'local.json'))).toBe(true)
    expect(await exists(join(a1.configHome(), 'settings.local.json'))).toBe(true)
  })
})

describe('gather → scatter via the service (two machines, one remote)', () => {
  it('propagates user-level memory and settings from m1 to m2', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    // Machine 1: seed ~/.claude, connect, register, gather.
    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'memoria de m1\n')
    await writeFile(join(home1, '.claude', 'commands', 'deploy.md'), 'deploy cmd\n')
    await writeFile(join(home1, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const a1 = adapterFor(home1)
    await connectRepo(remote, a1)
    await registerMachine(a1, 'm1')

    const gplan = await buildVerbPlan(a1, 'gather', { id: 'g', createdAt: 't' })
    const gres = await syncGather(a1, gplan)
    expect(gres.pushed).toBe(true)
    expect(gres.conflicts).toEqual([])

    // Machine 2: empty home, connect (clones memories), register, scatter.
    const home2 = join(base, 'home2')
    const a2 = adapterFor(home2)
    await connectRepo(remote, a2)
    await registerMachine(a2, 'm2')

    const pulled = await pullRepo(a2)
    expect(pulled.ok).toBe(true)

    const splan = await buildVerbPlan(a2, 'scatter', { id: 's', createdAt: 't' })
    await syncScatter(a2, splan)

    expect(await readFile(join(home2, '.claude', 'CLAUDE.md'), 'utf8')).toBe('memoria de m1\n')
    expect(await readFile(join(home2, '.claude', 'commands', 'deploy.md'), 'utf8')).toBe('deploy cmd\n')
    expect(JSON.parse(await readFile(join(home2, '.claude', 'settings.json'), 'utf8'))).toEqual({
      theme: 'dark',
    })

    // m2 status after the pull: clean and up to date.
    const st = await repoStatus(a2)
    expect(st.conflicted).toEqual([])
  })
})

describe('project operations (CRUD)', () => {
  async function setup() {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = adapterFor(join(base, 'home1'))
    await connectRepo(remote, a)
    await registerMachine(a, 'm1')
    return a
  }
  const cfg = (a: ReturnType<typeof adapterFor>) => loadConfig(configPath(a))

  it('creates an empty project; on an existing one it is a no-op and reports it; rejects invalid names', async () => {
    const a = await setup()
    expect(await createProject(a, 'demo-core')).toEqual({ alreadyExists: false })
    expect((await cfg(a)).projects['demo-core']).toEqual({ folders: {} })

    // Re-creating does not clobber the project: its folders stay intact.
    await setProjectFolder(a, 'demo-core', 'memory', '/tmp/x')
    expect(await createProject(a, 'demo-core')).toEqual({ alreadyExists: true })
    expect((await cfg(a)).projects['demo-core'].folders.memory.m1).toBe('/tmp/x')

    await expect(createProject(a, 'nombre con espacios')).rejects.toThrow()
    await expect(createProject(a, '..')).rejects.toThrow()
  })

  it("setProjectFolder upserts this machine's path and expands ~", async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x')
    expect((await cfg(a)).projects.proj.folders.memory.m1).toBe('/tmp/x')

    await setProjectFolder(a, 'proj', 'memory', '/tmp/y') // upsert
    expect((await cfg(a)).projects.proj.folders.memory.m1).toBe('/tmp/y')

    await setProjectFolder(a, 'proj', 'docs', '~/docs') // expands ~
    expect((await cfg(a)).projects.proj.folders.docs.m1).toBe(join(a.home(), 'docs'))
  })

  it('removeProjectFolder removes only this machine and cleans up the empty slot', async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x') // m1
    await setProjectFolder(a, 'proj', 'memory', '/other', 'm2') // another machine in the same slot

    await removeProjectFolder(a, 'proj', 'memory') // removes m1
    expect((await cfg(a)).projects.proj.folders.memory).toEqual({ m2: '/other' }) // survives because of m2

    await removeProjectFolder(a, 'proj', 'memory', 'm2') // removes m2 → empty slot
    expect((await cfg(a)).projects.proj.folders.memory).toBeUndefined()
  })

  it('deleteProject removes the whole project', async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x')
    await deleteProject(a, 'proj')
    expect((await cfg(a)).projects.proj).toBeUndefined()
  })
})
