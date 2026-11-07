/**
 * localStorage keys. Renamed with the app (#123): `claude-total-recall:*` →
 * `engram:*`. Main carries the old profile's localStorage into the new userData;
 * this moves each value to its new key on first read.
 */
export const THEME_KEY = 'engram:theme'
export const LOCALE_KEY = 'engram:locale'
const LEGACY_KEYS: Record<string, string> = {
  [THEME_KEY]: 'claude-total-recall:theme',
  [LOCALE_KEY]: 'claude-total-recall:locale',
}

/**
 * Reads `key`; if it's unset but its pre-rename key holds a value, moves that value
 * over (write new, delete old) and returns it. Never throws: localStorage can be
 * unavailable in odd modes, and then there's simply nothing stored.
 */
export function readStorageMigrated(key: string, storage: Storage = localStorage): string | null {
  try {
    const value = storage.getItem(key)
    if (value !== null) return value
    const legacy = LEGACY_KEYS[key]
    if (!legacy) return null
    const old = storage.getItem(legacy)
    if (old === null) return null
    storage.setItem(key, old)
    storage.removeItem(legacy)
    return old
  } catch {
    return null
  }
}
