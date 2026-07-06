import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import {
  DEFAULT_AUTOSYNC,
  ensureSettingsLocal,
  loadAutoSyncPrefs,
  loadLocalState,
  loadSettingsLocal,
  localStatePath,
  saveAutoSyncPrefs,
  saveLocalState,
  saveSettingsLocal,
  settingsLocalPath,
} from './localState'

let tmpHome: string
let adapter: PlatformAdapter

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'claudetr-localstate-'))
  adapter = createPlatformAdapter(process.platform, tmpHome)
})

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true })
})

describe('path helpers', () => {
  it('localStatePath is <configHome>/local.json', () => {
    expect(localStatePath(adapter)).toBe(join(adapter.configHome(), 'local.json'))
  })

  it('settingsLocalPath is <configHome>/settings.local.json', () => {
    expect(settingsLocalPath(adapter)).toBe(join(adapter.configHome(), 'settings.local.json'))
  })
})

describe('loadLocalState', () => {
  it('returns null when the machine is not registered', async () => {
    expect(await loadLocalState(adapter)).toBeNull()
  })

  it('round-trips through saveLocalState', async () => {
    await saveLocalState(adapter, { machineId: 'macbook-01' })
    expect(await loadLocalState(adapter)).toEqual({ machineId: 'macbook-01' })
  })

  it('creates configHome when missing on save', async () => {
    await saveLocalState(adapter, { machineId: 'abc' })
    const raw = await readFile(localStatePath(adapter), 'utf8')
    expect(JSON.parse(raw)).toEqual({ machineId: 'abc' })
  })

  it('rejects invalid local state on load', async () => {
    await mkdir(adapter.configHome(), { recursive: true })
    await writeFile(localStatePath(adapter), JSON.stringify({ nope: true }), 'utf8')
    await expect(loadLocalState(adapter)).rejects.toThrow()
  })
})

describe('preferencias de auto-sync', () => {
  it('devuelve el default cuando no hay local.json', async () => {
    expect(await loadAutoSyncPrefs(adapter)).toEqual(DEFAULT_AUTOSYNC)
  })

  it('devuelve el default para un local.json viejo sin autoSync (back-compat)', async () => {
    await saveLocalState(adapter, { machineId: 'm1' })
    expect(await loadAutoSyncPrefs(adapter)).toEqual(DEFAULT_AUTOSYNC)
  })

  it('round-trip: guarda y lee las prefs sin perder la identidad', async () => {
    await saveLocalState(adapter, { machineId: 'm1' })
    await saveAutoSyncPrefs(adapter, { enabled: false, intervalMs: 30_000 })
    expect(await loadAutoSyncPrefs(adapter)).toEqual({ enabled: false, intervalMs: 30_000 })
    expect((await loadLocalState(adapter))?.machineId).toBe('m1')
  })

  it('re-registrar la máquina no pisa las prefs ya guardadas', async () => {
    await saveLocalState(adapter, { machineId: 'm1' })
    await saveAutoSyncPrefs(adapter, { enabled: false, intervalMs: 45_000 })
    // saveLocalState con sólo la identidad (como hace registerMachine) las preserva.
    await saveLocalState(adapter, { machineId: 'm1' })
    expect(await loadAutoSyncPrefs(adapter)).toEqual({ enabled: false, intervalMs: 45_000 })
  })

  it('saveAutoSyncPrefs falla si la máquina no está registrada', async () => {
    await expect(saveAutoSyncPrefs(adapter, DEFAULT_AUTOSYNC)).rejects.toThrow()
  })
})

describe('settings.local.json', () => {
  it('loadSettingsLocal returns {} when the file is missing', async () => {
    expect(await loadSettingsLocal(adapter)).toEqual({})
  })

  it('round-trips through saveSettingsLocal', async () => {
    await saveSettingsLocal(adapter, { theme: 'dark', nested: { a: 1 } })
    expect(await loadSettingsLocal(adapter)).toEqual({ theme: 'dark', nested: { a: 1 } })
  })

  it('ensureSettingsLocal creates {} when missing', async () => {
    await ensureSettingsLocal(adapter)
    const raw = await readFile(settingsLocalPath(adapter), 'utf8')
    expect(JSON.parse(raw)).toEqual({})
  })

  it('ensureSettingsLocal does not overwrite an existing file', async () => {
    await saveSettingsLocal(adapter, { keep: 'me' })
    await ensureSettingsLocal(adapter)
    expect(await loadSettingsLocal(adapter)).toEqual({ keep: 'me' })
  })
})
