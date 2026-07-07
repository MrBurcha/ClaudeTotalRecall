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
  const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-eng-'))
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

/** Connects + registers a machine whose ~/.claude has already been seeded. */
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
  it('pushes local changes, another machine pulls them, and the bootstrap does not blow away the repo', async () => {
    const base = await newBase()
    await bareRemote(base)

    // m1 seeds ~/.claude and syncs (pushes).
    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'memoria de m1\n')
    await writeFile(join(home1, '.claude', 'commands', 'deploy.md'), 'deploy cmd\n')
    await writeFile(join(home1, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const a1 = await joinMachine(base, 'm1', home1)

    const out1 = await runSyncCycle(a1)
    expect(out1.kind).toBe('synced')
    if (out1.kind === 'synced') expect(out1.pushed).toBe(true)

    // m2: empty home. The first cycle is the bootstrap: pulls everything, without deleting the repo.
    const home2 = join(base, 'home2')
    const a2 = await joinMachine(base, 'm2', home2)
    const out2 = await runSyncCycle(a2)
    expect(out2.kind).toBe('synced')

    expect(await readFile(join(home2, '.claude', 'CLAUDE.md'), 'utf8')).toBe('memoria de m1\n')
    expect(await readFile(join(home2, '.claude', 'commands', 'deploy.md'), 'utf8')).toBe('deploy cmd\n')

    // The repo was NOT emptied: a fresh clone of the remote still has the memories.
    const a3 = adapterFor(join(base, 'home3'))
    await connectRepo(join(base, 'remote.git'), a3)
    expect(await exists(join(workingCopyDir(a3), `${COMMANDS}/deploy.md`))).toBe(true)
  })

  it('propagates a directory deletion and does not resurrect it', async () => {
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
    await runSyncCycle(a2) // bootstrap: pulls a.md and b.md
    expect(await exists(join(home2, '.claude', 'commands', 'a.md'))).toBe(true)

    // m1 deletes a.md locally and syncs ⇒ the deletion propagates to the repo.
    await rm(join(home1, '.claude', 'commands', 'a.md'))
    const outDel = await runSyncCycle(a1)
    expect(outDel.kind).toBe('synced')
    expect(await exists(join(workingCopyDir(a1), `${COMMANDS}/a.md`))).toBe(false)

    // No resurrection on m1: another cycle does not recreate it on the machine.
    await runSyncCycle(a1)
    expect(await exists(join(home1, '.claude', 'commands', 'a.md'))).toBe(false)

    // m2 pulls the deletion: a.md disappears from the machine; b.md survives.
    const out2 = await runSyncCycle(a2)
    expect(out2.kind).toBe('synced')
    expect(await exists(join(home2, '.claude', 'commands', 'a.md'))).toBe(false)
    expect(await exists(join(home2, '.claude', 'commands', 'b.md'))).toBe(true)
  })

  it('pushes a local commit that was left unpushed (else-branch, no machine changes)', async () => {
    const base = await newBase()
    await bareRemote(base)

    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home1, '.claude', 'commands', 'a.md'), 'A\n')
    const a1 = await joinMachine(base, 'm1', home1)
    await runSyncCycle(a1) // syncs; working copy == remote

    // Simulate a local commit that was not pushed (e.g. a push that failed earlier).
    const wc = workingCopyDir(a1)
    await writeFile(join(wc, `${COMMANDS}/extra.md`), 'extra\n')
    await run('git', ['-C', wc, 'add', '-A'])
    await run('git', ['-C', wc, '-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-m', 'sin pushear'])

    const out = await runSyncCycle(a1) // no machine changes ⇒ else-branch
    expect(out.kind).toBe('synced')

    // The remote received the commit that had been left local.
    const a3 = adapterFor(join(base, 'home3'))
    await connectRepo(join(base, 'remote.git'), a3)
    expect(await exists(join(workingCopyDir(a3), `${COMMANDS}/extra.md`))).toBe(true)
  })

  it('detects a conflict when two machines edit the same file', async () => {
    const base = await newBase()
    await bareRemote(base)

    const home1 = join(base, 'home1')
    await mkdir(join(home1, '.claude'), { recursive: true })
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'base\n')
    const a1 = await joinMachine(base, 'm1', home1)
    await runSyncCycle(a1)

    const home2 = join(base, 'home2')
    const a2 = await joinMachine(base, 'm2', home2)
    await runSyncCycle(a2) // pulls 'base'

    // Both edit CLAUDE.md differently, without syncing in between.
    await writeFile(join(home1, '.claude', 'CLAUDE.md'), 'cambio de m1\n')
    await runSyncCycle(a1) // m1 pushes its version

    await writeFile(join(home2, '.claude', 'CLAUDE.md'), 'cambio de m2\n')
    const out = await runSyncCycle(a2) // collides when pulling the remote
    expect(out.kind).toBe('conflict')
    if (out.kind === 'conflict') {
      expect(out.files).toContain('memories/user/CLAUDE.md')
    }
  })
})
