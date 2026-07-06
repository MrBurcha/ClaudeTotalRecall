import type { PlatformAdapter } from './PlatformAdapter'
import { LinuxAdapter } from './linux'
import { MacosAdapter } from './macos'

export type { PlatformAdapter } from './PlatformAdapter'
export { BasePlatformAdapter } from './PlatformAdapter'
export { LinuxAdapter } from './linux'
export { MacosAdapter } from './macos'

/** Selecciona el adapter por process.platform. Windows = rama futura. */
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
      throw new Error(
        `Plataforma no soportada: ${platform}. ClaudeTR soporta macOS y Linux (Windows a futuro).`,
      )
  }
}
