import { cpSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

/** The app's name — and so its userData folder name — before the Engram rename (#123). */
export const LEGACY_PRODUCT_NAME = 'Claude Total Recall'

/**
 * Carries the renderer's localStorage (theme + language) over from the pre-rename
 * userData folder (`…/Claude Total Recall`) to the new one (`…/Engram`), which
 * Electron derives from productName. One-shot and idempotent: it only runs while the
 * new profile has no `Local Storage` yet — never the userData root, which the
 * single-instance lock has already created by now.
 *
 * Only `Local Storage/` moves: caches and lock files are useless or held open by an
 * old copy that's still running. leveldb's `LOCK` is skipped for the same reason.
 * Best effort: on any failure the user just gets the default theme and language.
 */
export function migrateLocalStorage(appData: string, userData: string): 'copied' | 'skipped' {
  const from = join(appData, LEGACY_PRODUCT_NAME, 'Local Storage')
  const to = join(userData, 'Local Storage')
  if (existsSync(to) || !existsSync(from)) return 'skipped'
  try {
    cpSync(from, to, { recursive: true, filter: (src) => basename(src) !== 'LOCK' })
    return 'copied'
  } catch (e) {
    console.error('[engram] could not carry over the old localStorage', e)
    return 'skipped'
  }
}
