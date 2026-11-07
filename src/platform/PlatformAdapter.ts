import { homedir } from 'node:os'
import { join, normalize as pathNormalize } from 'node:path'
import type { Os } from '../core/types'

/**
 * The app's only OS-specific spot. With path munging gone, the adapter just expands
 * the home dir and normalizes separators.
 */
export interface PlatformAdapter {
  os(): Os
  home(): string
  claudeHome(): string // ~/.claude
  configHome(): string // ~/.config/engram
  /** Where releases before the Engram rename kept local state (#123). */
  legacyConfigHome(): string // ~/.config/claudetr
  expandHome(p: string): string
  normalize(p: string): string
}

/**
 * Shared base for every OS. `home` is injectable for tests (defaults to
 * os.homedir()).
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  protected readonly homeDir: string

  constructor(home: string = homedir()) {
    this.homeDir = home
  }

  abstract os(): Os

  home(): string {
    return this.homeDir
  }

  claudeHome(): string {
    return join(this.homeDir, '.claude')
  }

  configHome(): string {
    return join(this.homeDir, '.config', 'engram')
  }

  legacyConfigHome(): string {
    return join(this.homeDir, '.config', 'claudetr')
  }

  expandHome(p: string): string {
    if (p === '~') return this.homeDir
    // Accept both POSIX (`~/foo`) and Windows (`~\foo`) tilde forms; join then
    // normalizes to the local separator.
    if (p.startsWith('~/') || p.startsWith('~\\')) return join(this.homeDir, p.slice(2))
    return p
  }

  normalize(p: string): string {
    return pathNormalize(this.expandHome(p))
  }
}
