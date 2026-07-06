import type { Os } from '../core/types'
import { BasePlatformAdapter } from './PlatformAdapter'

export class LinuxAdapter extends BasePlatformAdapter {
  os(): Os {
    return 'linux'
  }
}
