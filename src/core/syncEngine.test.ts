import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { run } from './exec'
import { connectRepo, registerMachine, workingCopyDir } from './service'
import { runSyncCycle } from './syncEngine'

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
  const base = await mkdtemp(join(tmpdir(), 'claudetr-eng-'))
  bases.push(base)
  return base
}

async function bareRemote(base: string): Promise<string> {
  const remote = join(base, 'remote.git')
  await run('git', ['init', '--bare', '--initial-branch=main', remote])
  return remote
}

function adapterFor(home: string) {
  return createPlatformAdapter(process.platform, home)
}

/** Conecta + registra una máquina cuyo ~/.claude ya fue sembrado. */
async function joinMachine(base: string, name: string, home: string) {
  const remote = join(base, 'remote.git')
  const a = adapterFor(home)
  await connectRepo(remote, a)
  await registerMachine(a, name)
  return a
}

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

const COMMANDS = 'memories/user/commands'

describe('runSyncCycle', () => {
  it('sube cambios locales, otra máquina los baja, y el bootstrap no vuela el repo', async () => {
    const base = await newBase()
    await bareRemote(base)

    // m1 siembra ~/.claude y sincroniza (sube).
    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'memoria de m1\n')
    await writeFile(join(home1, '.claude', 'commands', 'deploy.md'), 'deploy cmd\n')
    await writeFile(join(home1, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const a1 = await joinMachine(base, 'm1', home1)

    const out1 = await runSyncCycle(a1)
    expect(out1.kind).toBe('synced')
    if (out1.kind === 'synced') expect(out1.pushed).toBe(true)

    // m2: home vacío. El primer ciclo es el bootstrap: baja todo, sin borrar el repo.
    const home2 = join(base, 'home2')
    const a2 = await joinMachine(base, 'm2', home2)
    const out2 = await runSyncCycle(a2)
    expect(out2.kind).toBe('synced')

    expect(await readFile(join(home2, '.claude', 'CLAUDE.md'), 'utf8')).toBe('memoria de m1\n')
    expect(await readFile(join(home2, '.claude', 'commands', 'deploy.md'), 'utf8')).toBe('deploy cmd\n')

    // El repo NO se vació: un clon fresco del remoto todavía tiene las memorias.
    const a3 = adapterFor(join(base, 'home3'))
    await connectRepo(join(base, 'remote.git'), a3)
    expect(await exists(join(workingCopyDir(a3), `${COMMANDS}/deploy.md`))).toBe(true)
  })

  it('propaga un borrado de directorio y no lo resucita', async () => {
    const base = await newBase()
    await bareRemote(base)

    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'commands', 'a.md'), 'A\n')
    await writeFile(join(home1, '.claude', 'commands', 'b.md'), 'B\n')
    const a1 = await joinMachine(base, 'm1', home1)
    await runSyncCycle(a1)

    const home2 = join(base, 'home2')
    const a2 = await joinMachine(base, 'm2', home2)
    await runSyncCycle(a2) // bootstrap: baja a.md y b.md
    expect(await exists(join(home2, '.claude', 'commands', 'a.md'))).toBe(true)

    // m1 borra a.md localmente y sincroniza ⇒ la baja se propaga al repo.
    await rm(join(home1, '.claude', 'commands', 'a.md'))
    const outDel = await runSyncCycle(a1)
    expect(outDel.kind).toBe('synced')
    expect(await exists(join(workingCopyDir(a1), `${COMMANDS}/a.md`))).toBe(false)

    // Sin resurrección en m1: otro ciclo no la recrea en la máquina.
    await runSyncCycle(a1)
    expect(await exists(join(home1, '.claude', 'commands', 'a.md'))).toBe(false)

    // m2 baja la baja: a.md desaparece de la máquina; b.md sobrevive.
    const out2 = await runSyncCycle(a2)
    expect(out2.kind).toBe('synced')
    expect(await exists(join(home2, '.claude', 'commands', 'a.md'))).toBe(false)
    expect(await exists(join(home2, '.claude', 'commands', 'b.md'))).toBe(true)
  })

  it('pushea un commit local que quedó sin pushear (else-branch, sin cambios de máquina)', async () => {
    const base = await newBase()
    await bareRemote(base)

    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'commands', 'a.md'), 'A\n')
    const a1 = await joinMachine(base, 'm1', home1)
    await runSyncCycle(a1) // sincroniza; working copy == remoto

    // Simular un commit local sin pushear (p.ej. un push que falló antes).
    const wc = workingCopyDir(a1)
    await writeFile(join(wc, `${COMMANDS}/extra.md`), 'extra\n')
    await run('git', ['-C', wc, 'add', '-A'])
    await run('git', ['-C', wc, '-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-m', 'sin pushear'])

    const out = await runSyncCycle(a1) // sin cambios de máquina ⇒ else-branch
    expect(out.kind).toBe('synced')

    // El remoto recibió el commit que había quedado local.
    const a3 = adapterFor(join(base, 'home3'))
    await connectRepo(join(base, 'remote.git'), a3)
    expect(await exists(join(workingCopyDir(a3), `${COMMANDS}/extra.md`))).toBe(true)
  })

  it('detecta conflicto cuando dos máquinas editan el mismo archivo', async () => {
    const base = await newBase()
    await bareRemote(base)

    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude'), { recursive: true })
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'base\n')
    const a1 = await joinMachine(base, 'm1', home1)
    await runSyncCycle(a1)

    const home2 = join(base, 'home2')
    const a2 = await joinMachine(base, 'm2', home2)
    await runSyncCycle(a2) // baja 'base'

    // Ambas editan CLAUDE.md distinto, sin sincronizar en el medio.
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'cambio de m1\n')
    await runSyncCycle(a1) // m1 sube su versión

    await writeFile(join(home2, '.claude', 'CLAUDE.md'), 'cambio de m2\n')
    const out = await runSyncCycle(a2) // choca al pullear el remoto
    expect(out.kind).toBe('conflict')
    if (out.kind === 'conflict') {
      expect(out.files).toContain('memories/user/CLAUDE.md')
    }
  })
})
