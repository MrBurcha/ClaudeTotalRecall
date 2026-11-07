import { rename, stat } from 'node:fs/promises'
import type { PlatformAdapter } from '../platform'
import { AppError } from './errors'

// ─────────────────────────────────────────────────────────────────────────────
// Local config dir rename for the Engram rebrand (#123):
// `~/.config/claudetr` → `~/.config/engram`.
//
// One atomic `rename` moves everything at once — the working copy (`repo/`, a git
// clone), `local.json` (machineId!), `settings.local.json`, `baseline.json`, the
// activity log, the sync lock — with no copying and no half state. It runs before
// anything else touches local state, in the app and in the CLI.
//
// - new exists          → 'noop' (if the old one ALSO exists, an old version was
//                         reinstalled after migrating: the new one wins and the old
//                         one is left alone — never deleted);
// - only old exists     → rename → 'migrated';
// - neither exists      → 'fresh' (normal onboarding creates the new one).
//
// A failed rename is an ERROR, never a silent 'fresh': starting fresh would drop the
// machine's identity and make it look brand new to the fleet.
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigHomeMigration = 'migrated' | 'noop' | 'fresh'

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function migrateConfigHome(adapter: PlatformAdapter): Promise<ConfigHomeMigration> {
  const next = adapter.configHome()
  const legacy = adapter.legacyConfigHome()
  if (await isDir(next)) return 'noop'
  if (!(await isDir(legacy))) return 'fresh'
  try {
    await rename(legacy, next)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new AppError(
      'configHome.migrationFailed',
      `Couldn't move the local data folder from ${legacy} to ${next} (${reason}). ` +
        'Quit any running copy of Claude Total Recall (and its command-line tool), then open Engram again.',
      { from: legacy, to: next, reason },
    )
  }
  return 'migrated'
}
