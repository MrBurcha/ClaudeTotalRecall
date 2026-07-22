import type { Os } from '../core/types'
import { BasePlatformAdapter } from './PlatformAdapter'

/**
 * Windows adapter. Deliberately keeps the shared `~/.config/claudetr` layout
 * (no `configHome()` override): macOS already uses `~/.config` too, so all three
 * OSes share one location, sitting beside Claude Code's own `~/.claude`. State is
 * home-relative via os.homedir() (%USERPROFILE%), never tied to the install dir,
 * so a portable .exe can be moved without losing the working copy.
 */
export class WindowsAdapter extends BasePlatformAdapter {
  os(): Os {
    return 'windows'
  }
}
