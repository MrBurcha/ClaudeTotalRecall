import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter } from '../platform'
import { buildGatherPlan, executeGather } from './gather'
import { PlanDriftError, type SyncContext } from './plan'
import { buildScatterPlan, executeScatter } from './scatter'
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

describe('gather → scatter round-trip', () => {
  it('reproduces files cross-machine, sanitizes settings and excludes secrets', async () => {
    const sb = await seed()
    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'ignored' })

    const plan = await buildGatherPlan(ctx1, META)

    // Guard: no secret in the Plan.
    for (const a of plan.actions) {
      expect(a.logicalPath).not.toMatch(/\.credentials\.json|\.jsonl$|\.claude\.json/)
      if (a.from) expect(a.from).not.toMatch(/\.credentials\.json|\.jsonl$|\.claude\.json/)
    }

    await executeGather(plan, ctx1)

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

    // Idempotency: re-planning gather produces no copies.
    const again = await buildGatherPlan(ctx1, META)
    expect(again.actions.filter((a) => a.type === 'create' || a.type === 'overwrite')).toHaveLength(
      0,
    )

    // Scatter to machine 2 (empty home + its own project path).
    const ctx2 = ctxFor(sb, sb.home2, 'm2', { local: 'M2VAL' })
    const splan = await buildScatterPlan(ctx2, META)
    await executeScatter(splan, ctx2)

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

    await executeGather(await buildGatherPlan(ctx1, META), ctx1)

    // Changes on the machine.
    await writeFile(join(sb.home1, '.claude/commands/foo.md'), 'CHANGED\n') // overwrite
    await writeFile(join(sb.home1, '.claude/commands/bar.md'), 'bar\n') // create
    await rm(join(sb.p1, 'note.md')) // delete (exists in repo, not in source)

    const plan = await buildGatherPlan(ctx1, META)
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

describe('TOCTOU revalidation', () => {
  it('aborts with PlanDriftError if the source changed, unless force', async () => {
    const sb = await seed()
    const ctx1 = ctxFor(sb, sb.home1, 'm1', { local: 'x' })

    const plan = await buildGatherPlan(ctx1, META)
    // Mutate a file with a pending create action.
    await writeFile(join(sb.home1, '.claude/CLAUDE.md'), 'MUTATED\n')

    await expect(executeGather(plan, ctx1)).rejects.toBeInstanceOf(PlanDriftError)
    // With force, it applies anyway.
    await expect(executeGather(plan, ctx1, { force: true })).resolves.toBeDefined()
  })
})
