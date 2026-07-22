import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { createPlatformAdapter, WindowsAdapter } from './index'

// Host-independent: assert against path.join (same primitive the adapter uses)
// rather than hardcoded separators, so the suite passes on the POSIX CI host too.
const HOME = 'C:\\Users\\x'

describe('WindowsAdapter', () => {
  const adapter = createPlatformAdapter('win32', HOME)

  it('is selected for win32 and reports os "windows"', () => {
    expect(adapter).toBeInstanceOf(WindowsAdapter)
    expect(adapter.os()).toBe('windows')
  })

  it('keeps the shared ~/.claude and ~/.config/claudetr layout', () => {
    expect(adapter.home()).toBe(HOME)
    expect(adapter.claudeHome()).toBe(join(HOME, '.claude'))
    expect(adapter.configHome()).toBe(join(HOME, '.config', 'claudetr'))
  })

  it('expands both POSIX and Windows tilde forms', () => {
    expect(adapter.expandHome('~')).toBe(HOME)
    expect(adapter.expandHome('~/foo')).toBe(join(HOME, 'foo'))
    expect(adapter.expandHome('~\\foo')).toBe(join(HOME, 'foo'))
  })

  it('passes absolute (non-tilde) paths through unchanged', () => {
    expect(adapter.expandHome('C:\\abs\\path')).toBe('C:\\abs\\path')
  })
})
