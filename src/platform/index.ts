import { AppError } from '../core/errors'
import type { PlatformAdapter } from './PlatformAdapter'
import { LinuxAdapter } from './linux'
import { MacosAdapter } from './macos'

export type { PlatformAdapter } from './PlatformAdapter'
export { BasePlatformAdapter } from './PlatformAdapter'
export { LinuxAdapter } from './linux'
export { MacosAdapter } from './macos'

/** Picks the adapter by process.platform. Windows is a future branch. */
export function createPlatformAdapter(
  platform: NodeJS.Platform = process.platform,
  home?: string,
): PlatformAdapter {
  switch (platform) {
    case 'darwin':
      return new MacosAdapter(home)
    case 'linux':
      return new LinuxAdapter(home)
    default:
      throw new AppError(
        'platform.unsupported',
        `Unsupported platform: ${platform}. Claude Total Recall supports macOS and Linux (Windows later).`,
        { platform },
      )
  }
}
