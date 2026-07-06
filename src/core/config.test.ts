import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from './types'
import { loadConfig, parseConfig, saveConfig } from './config'

const validConfig: Config = {
  version: 1,
  repo: { remote: 'https://github.com/acme/claudetr-repo.git' },
  machines: {
    'mac-01': { os: 'macos', hostname: 'macbook', home: '/Users/acme' },
    'linux-01': { os: 'linux', hostname: 'workstation', home: '/home/acme' },
  },
  projects: {
    'demo-core': {
      folders: {
        memory: {
          'mac-01': '/Users/acme/proj/memory',
          'linux-01': '/home/acme/proj/memory',
        },
      },
    },
  },
}

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const parsed = parseConfig(validConfig)
    expect(parsed).toEqual(validConfig)
  })

  it('throws when machines is missing', () => {
    const { machines: _machines, ...rest } = validConfig
    expect(() => parseConfig(rest)).toThrow()
  })

  it('throws when version is not 1', () => {
    expect(() => parseConfig({ ...validConfig, version: 2 })).toThrow()
  })

  it('throws when remote is empty', () => {
    expect(() => parseConfig({ ...validConfig, repo: { remote: '' } })).toThrow()
  })

  it('accepts non-http remotes (ssh, file://)', () => {
    expect(() =>
      parseConfig({ ...validConfig, repo: { remote: 'git@github.com:acme/repo.git' } }),
    ).not.toThrow()
  })

  it('throws on non-object input', () => {
    expect(() => parseConfig(null)).toThrow()
    expect(() => parseConfig('nope')).toThrow()
  })
})

describe('loadConfig / saveConfig', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'claudetr-config-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads a valid config file from disk', async () => {
    const filePath = join(dir, 'claudetr.json')
    await writeFile(filePath, JSON.stringify(validConfig), 'utf8')
    const loaded = await loadConfig(filePath)
    expect(loaded).toEqual(validConfig)
  })

  it('throws when loading an invalid config file', async () => {
    const filePath = join(dir, 'claudetr.json')
    await writeFile(filePath, JSON.stringify({ version: 1 }), 'utf8')
    await expect(loadConfig(filePath)).rejects.toThrow()
  })

  it('saveConfig writes pretty JSON with a trailing newline', async () => {
    const filePath = join(dir, 'claudetr.json')
    await saveConfig(filePath, validConfig)
    const raw = await readFile(filePath, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toBe(`${JSON.stringify(validConfig, null, 2)}\n`)
  })

  it('saveConfig validates before writing', async () => {
    const filePath = join(dir, 'claudetr.json')
    const bad = { ...validConfig, version: 99 } as unknown as Config
    await expect(saveConfig(filePath, bad)).rejects.toThrow()
  })

  it('round-trips save then load preserving data', async () => {
    const filePath = join(dir, 'claudetr.json')
    await saveConfig(filePath, validConfig)
    const loaded = await loadConfig(filePath)
    expect(loaded).toEqual(validConfig)
  })
})
