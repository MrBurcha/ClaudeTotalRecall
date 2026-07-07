import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { buildOutgoingPlan, executeOutgoing } from './outgoing'
import { PlanDriftError, type SyncContext } from './plan'
import { buildIncomingPlan, executeIncoming } from './incoming'
import type { Config } from './types'

const META = { id: 'test-plan', createdAt: '2026-07-05T00:00:00.000Z' }

async function read(p: string): Promise<string> {
  return readFile(p, 'utf8')
}
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

interface Sandbox {
  base: string
  home1: string
  home2: string
  repoDir: string
  config: Config
  p1: string
  p2: string
}

const bases: string[] = []

async function seed(): Promise<Sandbox> {
  const base = await mkdtemp(join(tmpdir(), 'claude-total-recall-plan-'))
  bases.push(base)
  const home1 = join(base, 'home1')
  const home2 = join(base, 'home2')
  const repoDir = join(base, 'repo')

  const claude1 = join(home1, '.claude')
  await mkdir(join(claude1, 'commands'), { recursive: true })
  await writeFile(join(claude1, 'CLAUDE.md'), 'user memory\n')
  await writeFile(join(claude1, 'commands', 'foo.md'), 'cmd\n')
  await writeFile(join(claude1, 'settings.json'), JSON.stringify({ a: 1, local: 'realv' }))
  const p1 = join(claude1, 'projects', 'proj', 'memory')
  await mkdir(p1, { recursive: true })
  await writeFile(join(p1, 'note.md'), 'project note\n')

  // Secrets planted inside synced dirs: they must NEVER enter the Plan.
  await writeFile(join(claude1, 'commands', '.credentials.json'), 'SECRET')
  await writeFile(join(claude1, 'commands', 'x.jsonl'), '{"t":1}')
  await writeFile(join(claude1, 'commands', '.claude.json'), 'DURABLE')
  await writeFile(join(p1, 'session.jsonl'), '{"t":2}')

  await mkdir(repoDir, { recursive: true })
  const p2 = join(home2, '.claude', 'projects', 'proj-m2', 'memory')

  const config: Config = {
    version: 1,
    repo: { remote: 'https://github.com/u/r.git' },
    machines: {
      m1: { os: 'macos', hostname: 'h1', home: home1 },
      m2: { os: 'linux', hostname: 'h2', home: home2 },
    },
    projects: {
      proj: {
        folders: {
          memory: { m1: p1, m2: p2 },
          extra: { m2: join(home2, 'extra') }, // no path for m1 → skip
        },
      },
    },
  }
  return { base, home1, home2, repoDir, config, p1, p2 }
}

function ctxFor(sb: Sandbox, home: string, machineId: string, localOverrides = {}): SyncContext {
  return {
    adapter: createPlatformAdapter(process.platform, home),
    config: sb.config,
    machineId,
    repoDir: sb.repoDir,
    localOverrides,
  }
}

afterEach(async () => {
  for (const b of bases.splice(0)) await rm(b, { recursive: true, force: true })
})

describe('outgoing → incoming round-trip', () => {
  it('reproduces files cross-machine, sanitizes settings and excludes secrets', async () => {
    const sb = await seed()
    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'ignored' })

    const plan = await buildOutgoingPlan(ctx1, META)

    // Guard: no secret in the Plan.
    for (const a of plan.actions) {
      expect(a.logicalPath).not.toMatch(/\.credentials\.json|\.jsonl$|\.claude\.json/)
      if (a.from) expect(a.from).not.toMatch(/\.credentials\.json|\.jsonl$|\.claude\.json/)
    }

    await executeOutgoing(plan, ctx1)

    // Repo populated with logical names.
    expect(await read(join(sb.repoDir, 'memories/user/CLAUDE.md'))).toBe('user memory\n')
    expect(await read(join(sb.repoDir, 'memories/user/commands/foo.md'))).toBe('cmd\n')
    expect(await read(join(sb.repoDir, 'memories/projects/proj/memory/note.md'))).toBe(
      'project note\n',
    )
    // shared settings = real without the local key.
    expect(JSON.parse(await read(join(sb.repoDir, 'memories/user/settings.json')))).toEqual({ a: 1 })

    // Secrets absent from the repo.
    expect(await exists(join(sb.repoDir, 'memories/user/commands/.credentials.json'))).toBe(false)
    expect(await exists(join(sb.repoDir, 'memories/user/commands/x.jsonl'))).toBe(false)
    expect(await exists(join(sb.repoDir, 'memories/user/commands/.claude.json'))).toBe(false)

    // Idempotency: re-planning outgoing produces no copies.
    const again = await buildOutgoingPlan(ctx1, META)
    expect(again.actions.filter((a) => a.type === 'create' || a.type === 'overwrite')).toHaveLength(
      0,
    )

    // Incoming to machine 2 (empty home + its own project path).
    const ctx2 = ctxFor(sb, sb.home2, 'm2', { local: 'M2VAL' })
    const splan = await buildIncomingPlan(ctx2, META)
    await executeIncoming(splan, ctx2)

    expect(await read(join(sb.home2, '.claude/CLAUDE.md'))).toBe('user memory\n')
    expect(await read(join(sb.home2, '.claude/commands/foo.md'))).toBe('cmd\n')
    // real settings = shared + m2 local override.
    expect(JSON.parse(await read(join(sb.home2, '.claude/settings.json')))).toEqual({
      a: 1,
      local: 'M2VAL',
    })
    expect(await read(join(sb.p2, 'note.md'))).toBe('project note\n')
  })
})

describe('Plan action types', () => {
  it('detects create / overwrite / noop / delete / skip', async () => {
    const sb = await seed()
    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'x' })

    await executeOutgoing(await buildOutgoingPlan(ctx1, META), ctx1)

    // Changes on the machine.
    await writeFile(join(sb.home1, '.claude/commands/foo.md'), 'CHANGED\n') // overwrite
    await writeFile(join(sb.home1, '.claude/commands/bar.md'), 'bar\n') // create
    await rm(join(sb.p1, 'note.md')) // delete (exists in repo, not in source)

    const plan = await buildOutgoingPlan(ctx1, META)
    const byLogical = new Map(plan.actions.map((a) => [a.logicalPath, a]))

    expect(byLogical.get('memories/user/commands/foo.md')?.type).toBe('overwrite')
    expect(byLogical.get('memories/user/commands/bar.md')?.type).toBe('create')
    expect(byLogical.get('memories/projects/proj/memory/note.md')?.type).toBe('delete')
    expect(byLogical.get('memories/user/CLAUDE.md')?.type).toBe('noop')
    // The 'extra' slot has no path for m1 → skip.
    const extra = plan.actions.find((a) => a.slot === 'project:proj/extra')
    expect(extra?.type).toBe('skip')
  })
})

describe('file slots and pinned files (#11)', () => {
  it('syncs a project file-slot and a global pinned file, skips missing and secret sources', async () => {
    const sb = await seed()

    // Sources on machine 1: a single project file, a global pinned file, a secret
    // pointed at directly, and a missing file. All are file kind.
    const singleSrc = join(sb.home1, '.claude', 'SINGLE.md')
    const pinSrc = join(sb.home1, '.claude', 'PIN.md')
    const secretSrc = join(sb.home1, '.claude', 'secret.jsonl')
    await writeFile(singleSrc, 'single file\n')
    await writeFile(pinSrc, 'pinned file\n')
    await writeFile(secretSrc, '{"x":1}')

    sb.config.projects.proj.folders.single = { m1: singleSrc, m2: join(sb.home2, '.claude', 'SINGLE.md') }
    sb.config.projects.proj.folders.missing = { m1: join(sb.home1, '.claude', 'NOPE.md') }
    sb.config.projects.proj.folders.secret = { m1: secretSrc }
    sb.config.projects.proj.slotKinds = { single: 'file', missing: 'file', secret: 'file' }
    sb.config.pinnedFiles = {
      rules: { m1: pinSrc, m2: join(sb.home2, '.claude', 'PIN.md') },
    }

    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'x' })
    const plan = await buildOutgoingPlan(ctx1, META)
    const bySlot = new Map(plan.actions.map((a) => [a.slot, a]))

    // File slot present → create at the exact logical path (not mirrored under it).
    expect(bySlot.get('project:proj/single')).toMatchObject({
      type: 'create',
      logicalPath: 'memories/projects/proj/single',
    })
    // Pinned file → create under memories/pinned/<pin>.
    expect(bySlot.get('pinned:rules')).toMatchObject({
      type: 'create',
      logicalPath: 'memories/pinned/rules',
    })
    // Missing source → skip (NOT delete), secret source → skip.
    expect(bySlot.get('project:proj/missing')).toMatchObject({ type: 'skip', reasonCode: 'sourceMissing' })
    expect(bySlot.get('project:proj/secret')).toMatchObject({ type: 'skip', reasonCode: 'secretExcluded' })

    await executeOutgoing(plan, ctx1)
    expect(await read(join(sb.repoDir, 'memories/projects/proj/single'))).toBe('single file\n')
    expect(await read(join(sb.repoDir, 'memories/pinned/rules'))).toBe('pinned file\n')
    // Secret never entered the repo.
    expect(await exists(join(sb.repoDir, 'memories/pinned/secret'))).toBe(false)

    // A file slot never mirror-deletes: with the source gone, re-planning yields a
    // skip (a dir slot would emit a delete for the repo copy).
    await rm(singleSrc)
    const after = await buildOutgoingPlan(ctx1, META)
    expect(after.actions.find((a) => a.slot === 'project:proj/single')?.type).toBe('skip')
    expect(await exists(join(sb.repoDir, 'memories/projects/proj/single'))).toBe(true)

    // Incoming on machine 2 rebuilds both the file slot and the pinned file.
    const ctx2 = ctxFor(sb, sb.home2, 'm2', { local: 'y' })
    await executeIncoming(await buildIncomingPlan(ctx2, META), ctx2)
    expect(await read(join(sb.home2, '.claude/SINGLE.md'))).toBe('single file\n')
    expect(await read(join(sb.home2, '.claude/PIN.md'))).toBe('pinned file\n')
  })
})

describe('TOCTOU revalidation', () => {
  it('aborts with PlanDriftError if the source changed, unless force', async () => {
    const sb = await seed()
    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'x' })

    const plan = await buildOutgoingPlan(ctx1, META)
    // Mutate a file with a pending create action.
    await writeFile(join(sb.home1, '.claude/CLAUDE.md'), 'MUTATED\n')

    await expect(executeOutgoing(plan, ctx1)).rejects.toBeInstanceOf(PlanDriftError)
    // With force, it applies anyway.
    await expect(executeOutgoing(plan, ctx1, { force: true })).resolves.toBeDefined()
  })
})
