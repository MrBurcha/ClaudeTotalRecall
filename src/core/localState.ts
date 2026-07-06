import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LocalStateSchema, type LocalState, type SettingsObject } from './types'
import type { PlatformAdapter } from '../platform'

export function localStatePath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'local.json')
}

export function settingsLocalPath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'settings.local.json')
}

async function readJson(path: string): Promise<unknown | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return JSON.parse(raw)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function loadLocalState(adapter: PlatformAdapter): Promise<LocalState | null> {
  const data = await readJson(localStatePath(adapter))
  if (data === null) return null
  return LocalStateSchema.parse(data)
}

export async function saveLocalState(adapter: PlatformAdapter, state: LocalState): Promise<void> {
  await writeJson(localStatePath(adapter), state)
}

export async function loadSettingsLocal(adapter: PlatformAdapter): Promise<SettingsObject> {
  const data = await readJson(settingsLocalPath(adapter))
  if (data === null) return {}
  return data as SettingsObject
}

export async function saveSettingsLocal(
  adapter: PlatformAdapter,
  obj: SettingsObject,
): Promise<void> {
  await writeJson(settingsLocalPath(adapter), obj)
}

export async function ensureSettingsLocal(adapter: PlatformAdapter): Promise<void> {
  const existing = await readJson(settingsLocalPath(adapter))
  if (existing === null) await writeJson(settingsLocalPath(adapter), {})
}
