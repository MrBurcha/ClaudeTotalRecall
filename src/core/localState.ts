import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  LocalStateSchema,
  type AutoSyncPrefs,
  type LocalState,
  type SettingsObject,
} from './types'
import type { PlatformAdapter } from '../platform'

/** Default de auto-sync: activado, poll del remoto cada 2 min (ver plan). */
export const DEFAULT_AUTOSYNC: AutoSyncPrefs = { enabled: true, intervalMs: 120_000 }

export function localStatePath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'local.json')
}

export function settingsLocalPath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'settings.local.json')
}

export function baselinePath(adapter: PlatformAdapter): string {
  return join(adapter.configHome(), 'baseline.json')
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
  // Merge sobre lo existente: guardar la identidad no debe pisar otras claves
  // locales (p.ej. autoSync) que se hayan seteado aparte.
  const prev = (await readJson(localStatePath(adapter))) as Record<string, unknown> | null
  await writeJson(localStatePath(adapter), { ...(prev ?? {}), ...state })
}

/** Preferencias de auto-sync de esta máquina (default si no hay local.json aún). */
export async function loadAutoSyncPrefs(adapter: PlatformAdapter): Promise<AutoSyncPrefs> {
  const state = await loadLocalState(adapter)
  return state?.autoSync ?? DEFAULT_AUTOSYNC
}

export async function saveAutoSyncPrefs(
  adapter: PlatformAdapter,
  prefs: AutoSyncPrefs,
): Promise<void> {
  const state = await loadLocalState(adapter)
  if (!state) throw new Error('Máquina no registrada; no hay dónde guardar las preferencias.')
  await saveLocalState(adapter, { ...state, autoSync: prefs })
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

// ─────────────────────────────────────────────────────────────────────────────
// Baseline del auto-sync (fuera del repo, por-máquina). Es el conjunto de
// logicalPaths que quedaron sincronizados al cerrar el último ciclo: sirve para
// distinguir un borrado local (estaba en el baseline) de un archivo nuevo del
// remoto que todavía no bajamos (no estaba). Ver core/syncEngine.ts.
// ─────────────────────────────────────────────────────────────────────────────

const BaselineSchema = z.object({ paths: z.array(z.string()) })

export async function loadBaseline(adapter: PlatformAdapter): Promise<Set<string>> {
  try {
    const data = await readJson(baselinePath(adapter))
    if (data === null) return new Set()
    return new Set(BaselineSchema.parse(data).paths)
  } catch {
    // Baseline corrupto ⇒ tratarlo como vacío: ese ciclo no propaga borrados,
    // pero nunca borra de más. Se repuebla al cerrar el ciclo.
    return new Set()
  }
}

export async function saveBaseline(adapter: PlatformAdapter, paths: Set<string>): Promise<void> {
  await writeJson(baselinePath(adapter), { paths: [...paths].sort() })
}
