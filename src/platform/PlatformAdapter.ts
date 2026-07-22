import { homedir } from 'node:os'
import { join, normalize as pathNormalize } from 'node:path'
import type { Os } from '../core/types'

/**
 * Único lugar OS-específico de la app. Con el munching de paths eliminado,
 * el adapter solo expande el home y normaliza separadores. Windows a futuro =
 * un adapter más + su rama en index.ts.
 */
export interface PlatformAdapter {
  os(): Os
  home(): string
  claudeHome(): string // ~/.claude
  configHome(): string // ~/.config/claudetr
  expandHome(p: string): string
  normalize(p: string): string
}

/**
 * Base compartida por linux/macos. El `home` es inyectable para tests
 * (por defecto os.homedir()).
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
