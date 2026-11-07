import { describe, expect, it } from 'vitest'
import {
  checkForNewRelease,
  currentVersionInstaller,
  isNewerVersion,
  isRepoReleaseUrl,
  isWrongBuild,
  machineFacts,
  RELEASES_PAGE_URL,
  selectInstaller,
  type MachineFacts,
  type ReleaseAsset,
  type ReleaseCheckDeps,
} from './releaseCheck'

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as Response

const DOWNLOAD = 'https://github.com/MrBurcha/Engram/releases/download'

/** The real asset list of a release (v0.14.0), under any product-name prefix. */
function assetsFor(version: string, prefix = 'engram'): ReleaseAsset[] {
  return [
    `linux-amd64.deb`,
    `linux-x64.pacman`,
    `linux-x86_64.AppImage`,
    `linux-x86_64.rpm`,
    `macos-arm64.dmg`,
    `macos-x64.dmg`,
    `windows-portable.exe`,
    `windows-setup.exe`,
  ].map((suffix) => {
    const name = `${prefix}-${version}-${suffix}`
    return { name, browser_download_url: `${DOWNLOAD}/v${version}/${name}` }
  })
}
const ASSETS = assetsFor('0.9.0')
const url = (suffix: string): string => `${DOWNLOAD}/v0.9.0/engram-0.9.0-${suffix}`

const facts = (over: Partial<MachineFacts> = {}): MachineFacts => ({
  platform: 'darwin',
  arch: 'arm64',
  translated: false,
  portable: false,
  appImage: false,
  ...over,
})

describe('isNewerVersion', () => {
  it('is true when the candidate is newer', () => {
    expect(isNewerVersion('v0.9.0', '0.8.1')).toBe(true)
    expect(isNewerVersion('v1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('v0.8.2', '0.8.1')).toBe(true)
  })

  it('is false when equal or older', () => {
    expect(isNewerVersion('v0.8.1', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.8.0', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.7.9', '0.8.1')).toBe(false)
  })

  it('is false for malformed tags', () => {
    expect(isNewerVersion('not-a-version', '0.8.1')).toBe(false)
    expect(isNewerVersion('v1.0.0-beta', '0.8.1')).toBe(false)
    expect(isNewerVersion('v0.9.0', 'garbage')).toBe(false)
  })
})

describe('machineFacts', () => {
  it('reports the real chip (arm64) for the Intel build under Rosetta', () => {
    const f = machineFacts({ platform: 'darwin', arch: 'x64', translated: true, env: {} })
    expect(f).toMatchObject({ arch: 'arm64', translated: true })
    expect(isWrongBuild(f)).toBe(true)
  })

  it('keeps process.arch on a native build', () => {
    const f = machineFacts({ platform: 'darwin', arch: 'x64', translated: false, env: {} })
    expect(f.arch).toBe('x64')
    expect(isWrongBuild(f)).toBe(false)
  })

  it('only flags a wrong build on macOS (x64 on Windows-on-ARM has no native build)', () => {
    const f = machineFacts({ platform: 'win32', arch: 'x64', translated: true, env: {} })
    expect(isWrongBuild(f)).toBe(false)
  })

  it('detects the Windows portable build and an AppImage from their env vars', () => {
    const env = { PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe', APPIMAGE: '/tmp/x.AppImage' }
    expect(machineFacts({ platform: 'win32', arch: 'x64', translated: false, env })).toMatchObject({
      portable: true,
      appImage: false,
    })
    expect(machineFacts({ platform: 'linux', arch: 'x64', translated: false, env })).toMatchObject({
      portable: false,
      appImage: true,
    })
    expect(
      machineFacts({ platform: 'win32', arch: 'x64', translated: false, env: {} }).portable,
    ).toBe(false)
  })
})

describe('selectInstaller', () => {
  it('Apple Silicon → the arm64 dmg', () => {
    expect(selectInstaller(ASSETS, facts({ arch: 'arm64' }))).toEqual({
      url: url('macos-arm64.dmg'),
      variant: 'macos-arm64',
    })
  })

  it('Intel Mac → the x64 dmg', () => {
    expect(selectInstaller(ASSETS, facts({ arch: 'x64' }))).toEqual({
      url: url('macos-x64.dmg'),
      variant: 'macos-x64',
    })
  })

  it('the Intel build under Rosetta → the arm64 dmg (#134)', () => {
    const f = machineFacts({ platform: 'darwin', arch: 'x64', translated: true, env: {} })
    expect(selectInstaller(ASSETS, f)).toEqual({
      url: url('macos-arm64.dmg'),
      variant: 'macos-arm64',
    })
  })

  it('Windows → the setup installer, or the portable exe for the portable build', () => {
    expect(selectInstaller(ASSETS, facts({ platform: 'win32', arch: 'x64' }))).toEqual({
      url: url('windows-setup.exe'),
      variant: 'windows-setup',
    })
    expect(
      selectInstaller(ASSETS, facts({ platform: 'win32', arch: 'x64', portable: true })),
    ).toEqual({ url: url('windows-portable.exe'), variant: 'windows-portable' })
  })

  it('Linux AppImage → the AppImage', () => {
    expect(
      selectInstaller(ASSETS, facts({ platform: 'linux', arch: 'x64', appImage: true })),
    ).toEqual({ url: url('linux-x86_64.AppImage'), variant: 'linux-appimage' })
  })

  it('Linux deb/rpm/pacman (indistinguishable) → the releases page', () => {
    expect(selectInstaller(ASSETS, facts({ platform: 'linux', arch: 'x64' }))).toEqual({
      url: RELEASES_PAGE_URL,
      variant: null,
    })
  })

  it('no matching asset → the releases page', () => {
    const page = { url: RELEASES_PAGE_URL, variant: null }
    expect(selectInstaller([], facts())).toEqual(page)
    // An arch with no build (Linux arm64 AppImage, a hypothetical macOS arch, FreeBSD).
    expect(
      selectInstaller(ASSETS, facts({ platform: 'linux', arch: 'arm64', appImage: true })),
    ).toEqual(page)
    expect(selectInstaller(ASSETS, facts({ arch: 'ia32' }))).toEqual(page)
    expect(selectInstaller(ASSETS, facts({ platform: 'freebsd', arch: 'x64' }))).toEqual(page)
  })

  it('matches by suffix only, whatever the product-name prefix is', () => {
    const renamed = assetsFor('0.9.0', 'engram')
    expect(selectInstaller(renamed, facts()).url).toBe(
      `${DOWNLOAD}/v0.9.0/engram-0.9.0-macos-arm64.dmg`,
    )
  })

  it('never picks a look-alike (.blockmap) or a download outside this repo', () => {
    const assets: ReleaseAsset[] = [
      { name: 'x-macos-arm64.dmg.blockmap', browser_download_url: `${DOWNLOAD}/v1/x.blockmap` },
      { name: 'x-macos-arm64.dmg', browser_download_url: 'https://evil.example/x-macos-arm64.dmg' },
    ]
    expect(selectInstaller(assets, facts())).toEqual({ url: RELEASES_PAGE_URL, variant: null })
  })
})

describe('isRepoReleaseUrl', () => {
  it('accepts the releases page, a tag page and an asset download', () => {
    expect(isRepoReleaseUrl(RELEASES_PAGE_URL)).toBe(true)
    expect(isRepoReleaseUrl(`${RELEASES_PAGE_URL}/tag/v0.14.0`)).toBe(true)
    expect(isRepoReleaseUrl(url('macos-arm64.dmg'))).toBe(true)
    // GitHub owner/repo names are case-insensitive.
    expect(isRepoReleaseUrl('https://github.com/mrburcha/engram/releases')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const bad of [
      'http://github.com/MrBurcha/Engram/releases',
      'https://github.com.evil.example/MrBurcha/Engram/releases',
      'https://evil.example/MrBurcha/Engram/releases',
      'https://github.com/MrBurcha/Engram',
      'https://github.com/MrBurcha/Engram/releasesX',
      'https://github.com/MrBurcha/Other/releases',
      'https://github.com/MrBurcha/Engram/releases/../../Other/releases',
      'https://user:pw@github.com/MrBurcha/Engram/releases',
      'https://github.com:8443/MrBurcha/Engram/releases',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(isRepoReleaseUrl(bad), bad).toBe(false)
    }
  })
})

describe('checkForNewRelease', () => {
  const latest = (tag: string, assets?: unknown): ReleaseCheckDeps => ({
    fetch: async () =>
      jsonResponse(assets === undefined ? { tag_name: tag } : { tag_name: tag, assets }),
  })

  it('reports an update with the installer for this machine', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('v0.9.0', ASSETS))
    expect(result).toEqual({
      ok: true,
      update: { latestVersion: 'v0.9.0', url: url('macos-arm64.dmg'), variant: 'macos-arm64' },
    })
  })

  it('links the releases page when the release lists no assets', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('v0.9.0'))
    expect(result).toEqual({
      ok: true,
      update: { latestVersion: 'v0.9.0', url: RELEASES_PAGE_URL, variant: null },
    })
  })

  it('still reports the update when the asset list is malformed', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('v0.9.0', [{ nope: 1 }]))
    expect(result).toEqual({
      ok: true,
      update: { latestVersion: 'v0.9.0', url: RELEASES_PAGE_URL, variant: null },
    })
  })

  it('reports no update when already on the latest', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('v0.8.1', ASSETS))
    expect(result).toEqual({ ok: true, update: null })
  })

  it('reports no update when the latest tag is older', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('v0.7.0'))
    expect(result).toEqual({ ok: true, update: null })
  })

  it('treats a non-200 response (e.g. 404, no stable release yet) as a network failure', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({}, false, 404) }
    const result = await checkForNewRelease('0.8.1', facts(), deps)
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('reports a network failure when fetch rejects', async () => {
    const deps: ReleaseCheckDeps = {
      fetch: async () => {
        throw new Error('offline')
      },
    }
    const result = await checkForNewRelease('0.8.1', facts(), deps)
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('reports a parse failure on malformed JSON', async () => {
    const deps: ReleaseCheckDeps = {
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('bad json')
          },
        }) as unknown as Response,
    }
    const result = await checkForNewRelease('0.8.1', facts(), deps)
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })

  it('reports a parse failure when the response shape is unexpected', async () => {
    const deps: ReleaseCheckDeps = { fetch: async () => jsonResponse({ nope: true }) }
    const result = await checkForNewRelease('0.8.1', facts(), deps)
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })

  it('reports a parse failure when tag_name does not look like a version', async () => {
    const result = await checkForNewRelease('0.8.1', facts(), latest('not-a-version'))
    expect(result).toEqual({ ok: false, reason: 'parse' })
  })
})

describe('currentVersionInstaller', () => {
  const rosetta = machineFacts({ platform: 'darwin', arch: 'x64', translated: true, env: {} })

  it("fetches the running version's own release and picks the arm64 dmg (#133)", async () => {
    const requested: string[] = []
    const deps: ReleaseCheckDeps = {
      fetch: async (input) => {
        requested.push(String(input))
        return jsonResponse({ tag_name: 'v0.9.0', assets: ASSETS })
      },
    }
    const link = await currentVersionInstaller('0.9.0', rosetta, deps)
    expect(link).toEqual({ url: url('macos-arm64.dmg'), variant: 'macos-arm64' })
    expect(requested).toEqual(['https://api.github.com/repos/MrBurcha/Engram/releases/tags/v0.9.0'])
  })

  it('falls back to the releases page when offline or the tag has no release', async () => {
    const page = { url: RELEASES_PAGE_URL, variant: null }
    const offline: ReleaseCheckDeps = {
      fetch: async () => {
        throw new Error('offline')
      },
    }
    expect(await currentVersionInstaller('0.9.0', rosetta, offline)).toEqual(page)
    const missing: ReleaseCheckDeps = { fetch: async () => jsonResponse({}, false, 404) }
    expect(await currentVersionInstaller('0.9.0', rosetta, missing)).toEqual(page)
  })

  it('never fetches for a version that is not X.Y.Z', async () => {
    let fetched = false
    const deps: ReleaseCheckDeps = {
      fetch: async () => {
        fetched = true
        return jsonResponse({})
      },
    }
    expect(await currentVersionInstaller('dev', rosetta, deps)).toEqual({
      url: RELEASES_PAGE_URL,
      variant: null,
    })
    expect(fetched).toBe(false)
  })
})
