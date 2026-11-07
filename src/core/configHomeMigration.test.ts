import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import { migrateConfigHome } from './configHomeMigration'

let tmpHome: string
let adapter: PlatformAdapter

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function seedLegacy(): Promise<void> {
  const old = adapter.legacyConfigHome()
  await mkdir(join(old, 'repo', '.git'), { recursive: true })
  await writeFile(join(old, 'local.json'), JSON.stringify({ machineId: 'gamer' }))
  await writeFile(join(old, 'repo', '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'engram-migrate-'))
  adapter = createPlatformAdapter(process.platform, tmpHome)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.doUnmock('node:fs/promises')
  await rm(tmpHome, { recursive: true, force: true })
})

describe('migrateConfigHome (#123)', () => {
  it('moves the old dir to the new one in one step, identity and clone intact', async () => {
    await seedLegacy()
    expect(await migrateConfigHome(adapter)).toBe('migrated')
    const next = adapter.configHome()
    expect(JSON.parse(await readFile(join(next, 'local.json'), 'utf8'))).toEqual({
      machineId: 'gamer',
    })
    expect(await readFile(join(next, 'repo', '.git', 'HEAD'), 'utf8')).toContain('refs/heads/main')
    expect(await exists(adapter.legacyConfigHome())).toBe(false)
  })

  it('is a no-op once migrated (idempotent)', async () => {
    await seedLegacy()
    await migrateConfigHome(adapter)
    expect(await migrateConfigHome(adapter)).toBe('noop')
  })

  it('both exist (old version reinstalled after migrating): new wins, old left intact', async () => {
    await seedLegacy()
    await mkdir(adapter.configHome(), { recursive: true })
    await writeFile(join(adapter.configHome(), 'local.json'), JSON.stringify({ machineId: 'new' }))
    expect(await migrateConfigHome(adapter)).toBe('noop')
    expect(await exists(join(adapter.legacyConfigHome(), 'local.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(adapter.configHome(), 'local.json'), 'utf8'))).toEqual({
      machineId: 'new',
    })
  })

  it('neither exists: fresh (onboarding creates the new one later)', async () => {
    expect(await migrateConfigHome(adapter)).toBe('fresh')
    expect(await exists(adapter.configHome())).toBe(false)
  })

  it('a failed rename is an error with a code, never a silent fresh start', async () => {
    await seedLegacy()
    vi.resetModules()
    vi.doMock('node:fs/promises', async (orig) => {
      const real = await orig<typeof import('node:fs/promises')>()
      return {
        ...real,
        rename: vi.fn(async () => {
          throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        }),
      }
    })
    const { migrateConfigHome: migrate } = await import('./configHomeMigration')
    await expect(migrate(adapter)).rejects.toMatchObject({
      code: 'configHome.migrationFailed',
      params: { reason: expect.stringContaining('EBUSY') },
    })
    expect(await exists(join(adapter.legacyConfigHome(), 'local.json'))).toBe(true)
  })
})
