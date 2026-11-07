import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_PRODUCT_NAME, migrateLocalStorage } from './userDataMigration'

let appData: string
let userData: string

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), 'engram-userdata-'))
  userData = join(appData, 'Engram')
  await mkdir(userData, { recursive: true }) // the single-instance lock creates it first
})

afterEach(async () => {
  await rm(appData, { recursive: true, force: true })
})

async function seedOld(): Promise<string> {
  const ls = join(appData, LEGACY_PRODUCT_NAME, 'Local Storage', 'leveldb')
  await mkdir(ls, { recursive: true })
  await writeFile(join(ls, '000003.log'), 'theme=light')
  await writeFile(join(ls, 'LOCK'), '')
  return ls
}

describe('migrateLocalStorage (#123)', () => {
  it('copies the old Local Storage into the new profile, skipping the leveldb LOCK', async () => {
    await seedOld()
    expect(migrateLocalStorage(appData, userData)).toBe('copied')
    const ls = join(userData, 'Local Storage', 'leveldb')
    expect(await readFile(join(ls, '000003.log'), 'utf8')).toBe('theme=light')
    expect(await exists(join(ls, 'LOCK'))).toBe(false)
  })

  it('never overwrites a profile that already has Local Storage (one-shot)', async () => {
    await seedOld()
    await mkdir(join(userData, 'Local Storage'), { recursive: true })
    expect(migrateLocalStorage(appData, userData)).toBe('skipped')
    expect(await exists(join(userData, 'Local Storage', 'leveldb'))).toBe(false)
  })

  it('nothing to carry over → skipped', () => {
    expect(migrateLocalStorage(appData, userData)).toBe('skipped')
  })
})
