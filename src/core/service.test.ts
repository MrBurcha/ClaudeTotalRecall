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
  const base = await mkdtemp(join(tmpdir(), 'claudetr-svc-'))
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
  it('inicializa la estructura en un repo vacío y no re-inicializa uno con contenido', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    const a1 = adapterFor(join(base, 'home1'))
    const r1 = await connectRepo(remote, a1)
    expect(r1.initialized).toBe(true)
    expect(await exists(configPath(a1))).toBe(true)
    expect(await exists(join(workingCopyDir(a1), 'memories/user/commands/.gitkeep'))).toBe(true)

    // Otra máquina clona el repo ya inicializado.
    const a2 = adapterFor(join(base, 'home2'))
    const r2 = await connectRepo(remote, a2)
    expect(r2.initialized).toBe(false)
    expect(await exists(configPath(a2))).toBe(true)
  })
})

describe('registerMachine', () => {
  it('es idempotente y no pierde registros de máquinas distintas', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    const a1 = adapterFor(join(base, 'home1'))
    await connectRepo(remote, a1)
    const a2 = adapterFor(join(base, 'home2'))
    await connectRepo(remote, a2)

    const reg1 = await registerMachine(a1, 'machine-one')
    expect(reg1.machineId).toBe('machine-one')
    expect(reg1.alreadyRegistered).toBe(false)

    // Re-registrar la misma es idempotente.
    const reg1b = await registerMachine(a1, 'machine-one')
    expect(reg1b.alreadyRegistered).toBe(true)

    // a2 registra otra máquina; el fetch+reset+reapply no pisa a machine-one.
    const reg2 = await registerMachine(a2, 'machine-two')
    expect(reg2.machineId).toBe('machine-two')

    // El remoto tiene ambas.
    const g1 = new Git(workingCopyDir(a1))
    await g1.fetch()
    await g1.resetHard('origin/main')
    const config = await loadConfig(configPath(a1))
    expect(Object.keys(config.machines).sort()).toEqual(['machine-one', 'machine-two'])

    // Se escribió el local.json con la identidad.
    expect(await exists(join(a1.configHome(), 'local.json'))).toBe(true)
    expect(await exists(join(a1.configHome(), 'settings.local.json'))).toBe(true)
  })
})

describe('gather → scatter vía servicio (dos máquinas, un remoto)', () => {
  it('propaga memoria user-level y settings de m1 a m2', async () => {
    const base = await newBase()
    const remote = await bareRemote(base)

    // Máquina 1: sembrar ~/.claude, conectar, registrar, gather.
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

    // Máquina 2: home vacío, conectar (clona memorias), registrar, scatter.
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

    // status de m2 tras el pull: limpio y al día.
    const st = await repoStatus(a2)
    expect(st.conflicted).toEqual([])
  })
})

describe('operaciones de proyecto (CRUD)', () => {
  async function setup() {
    const base = await newBase()
    const remote = await bareRemote(base)
    const a = adapterFor(join(base, 'home1'))
    await connectRepo(remote, a)
    await registerMachine(a, 'm1')
    return a
  }
  const cfg = (a: ReturnType<typeof adapterFor>) => loadConfig(configPath(a))

  it('crea proyecto vacío; rechaza duplicados y nombres inválidos', async () => {
    const a = await setup()
    await createProject(a, 'demo-core')
    expect((await cfg(a)).projects['demo-core']).toEqual({ folders: {} })
    await expect(createProject(a, 'demo-core')).rejects.toThrow()
    await expect(createProject(a, 'nombre con espacios')).rejects.toThrow()
    await expect(createProject(a, '..')).rejects.toThrow()
  })

  it('setProjectFolder hace upsert del path de esta máquina y expande ~', async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x')
    expect((await cfg(a)).projects.proj.folders.memory.m1).toBe('/tmp/x')

    await setProjectFolder(a, 'proj', 'memory', '/tmp/y') // upsert
    expect((await cfg(a)).projects.proj.folders.memory.m1).toBe('/tmp/y')

    await setProjectFolder(a, 'proj', 'docs', '~/docs') // expande ~
    expect((await cfg(a)).projects.proj.folders.docs.m1).toBe(join(a.home(), 'docs'))
  })

  it('removeProjectFolder quita solo esta máquina y limpia la ranura vacía', async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x') // m1
    await setProjectFolder(a, 'proj', 'memory', '/other', 'm2') // otra máquina en la misma ranura

    await removeProjectFolder(a, 'proj', 'memory') // quita m1
    expect((await cfg(a)).projects.proj.folders.memory).toEqual({ m2: '/other' }) // sobrevive por m2

    await removeProjectFolder(a, 'proj', 'memory', 'm2') // quita m2 → ranura vacía
    expect((await cfg(a)).projects.proj.folders.memory).toBeUndefined()
  })

  it('deleteProject elimina el proyecto entero', async () => {
    const a = await setup()
    await setProjectFolder(a, 'proj', 'memory', '/tmp/x')
    await deleteProject(a, 'proj')
    expect((await cfg(a)).projects.proj).toBeUndefined()
  })
})
