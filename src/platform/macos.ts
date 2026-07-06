import type { Os } from '../core/types'
import { BasePlatformAdapter } from './PlatformAdapter'

export class MacosAdapter extends BasePlatformAdapter {
  os(): Os {
    return 'macos'
  }
}
