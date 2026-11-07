import { z } from 'zod'

export const GITHUB_OWNER = 'MrBurcha'
export const GITHUB_REPO = 'ClaudeTotalRecall'

const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
const LATEST_RELEASE_API_URL = `${RELEASES_API_URL}/latest`
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

const ReleaseAssetSchema = z.object({ name: z.string(), browser_download_url: z.string() })
export type ReleaseAsset = z.infer<typeof ReleaseAssetSchema>

const ReleaseSchema = z.object({
  tag_name: z.string(),
  // A missing or malformed asset list only costs the exact-installer link (the
  // banner falls back to the releases page); it never hides the update itself.
  assets: z.array(ReleaseAssetSchema).catch([]),
})
type Release = z.infer<typeof ReleaseSchema>

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** Parses a `vX.Y.Z` (or bare `X.Y.Z`) tag into a comparable tuple, or null if it doesn't match. */
function parseVersion(tag: string): [number, number, number] | null {
  const m = VERSION_RE.exec(tag)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/**
 * True if `candidate` (a `vX.Y.Z` tag) is a newer version than `current` (a bare
 * `X.Y.Z`, e.g. `app.getVersion()`/`package.json`'s `version`). Only plain semver
 * is supported — this project has never tagged a pre-release suffix (`v0.1.0`
 * through the current release are all clean `X.Y.Z`), so that's out of scope here;
 * revisit if the tagging scheme ever changes.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/**
 * True for an https github.com URL inside this repo's releases: the releases page
 * itself, a tag page, or a `/releases/download/…` asset. The only URLs the app
 * hands to the OS browser from the update notices. Owner/repo compare
 * case-insensitively, like GitHub; `..` segments are already resolved by URL.
 */
export function isRepoReleaseUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return false
  if (u.port !== '' || u.username !== '' || u.password !== '') return false
  const base = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases`.toLowerCase()
  const p = u.pathname.toLowerCase()
  return p === base || p.startsWith(`${base}/`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Installer selection (#134): link the notice to the exact asset for this machine.
// ─────────────────────────────────────────────────────────────────────────────

/** Which installer a link points to, so the notice can say "Download for Apple Silicon". */
export type InstallerVariant =
  'macos-arm64' | 'macos-x64' | 'windows-setup' | 'windows-portable' | 'linux-appimage'

/**
 * Plain facts about the running machine and build. The Electron main process
 * gathers them (`app.runningUnderARM64Translation`, env vars) so core stays
 * Electron-free; see `machineFacts`.
 */
export interface MachineFacts {
  platform: NodeJS.Platform
  /** The hardware's real CPU: arm64 for an x64 build under ARM64 translation, else process.arch. */
  arch: string
  /** This process is an x64 build translated on ARM64 hardware (Rosetta on macOS). */
  translated: boolean
  /** Windows: the portable build is running (electron-builder sets PORTABLE_EXECUTABLE_FILE). */
  portable: boolean
  /** Linux: running from an AppImage (the AppImage runtime sets APPIMAGE). */
  appImage: boolean
}

export function machineFacts(input: {
  platform: NodeJS.Platform
  /** process.arch: the arch this build was compiled for, x64 under Rosetta */
  arch: string
  /** app.runningUnderARM64Translation */
  translated: boolean
  env: Record<string, string | undefined>
}): MachineFacts {
  return {
    platform: input.platform,
    arch: input.translated ? 'arm64' : input.arch,
    translated: input.translated,
    portable: input.platform === 'win32' && !!input.env.PORTABLE_EXECUTABLE_FILE,
    appImage: input.platform === 'linux' && !!input.env.APPIMAGE,
  }
}

/**
 * The Intel build running under Rosetta on an Apple Silicon Mac (#133): it works
 * (git/gh are launched natively), but slower and only thanks to that workaround.
 * macOS only — x64 under Windows-on-ARM emulation has no native build to offer.
 */
export function isWrongBuild(facts: MachineFacts): boolean {
  return facts.platform === 'darwin' && facts.translated
}

/** Where a notice sends the user: the exact installer, or the releases page (variant null). */
export interface InstallerLink {
  url: string
  variant: InstallerVariant | null
}

const RELEASES_PAGE_LINK: InstallerLink = { url: RELEASES_PAGE_URL, variant: null }

/** AppImage's arch token in the asset name (electron-builder: x64 → x86_64). Only x64 ships. */
const APPIMAGE_ARCH: Record<string, string> = { x64: 'x86_64' }

/**
 * The asset-name suffix of this machine's installer, or null when it can't be told
 * apart. Matched by suffix only, never by the `${name}` prefix (the product is
 * about to be renamed, which changes every asset's prefix).
 */
function wantedInstaller(
  facts: MachineFacts,
): { suffix: string; variant: InstallerVariant } | null {
  switch (facts.platform) {
    case 'darwin':
      if (facts.arch === 'arm64') return { suffix: '-macos-arm64.dmg', variant: 'macos-arm64' }
      if (facts.arch === 'x64') return { suffix: '-macos-x64.dmg', variant: 'macos-x64' }
      return null
    case 'win32':
      return facts.portable
        ? { suffix: '-windows-portable.exe', variant: 'windows-portable' }
        : { suffix: '-windows-setup.exe', variant: 'windows-setup' }
    case 'linux': {
      // deb/rpm/pacman installs look identical from inside the app; only an
      // AppImage announces itself, so anything else gets the releases page.
      const arch = APPIMAGE_ARCH[facts.arch]
      if (!facts.appImage || !arch) return null
      return { suffix: `-linux-${arch}.AppImage`, variant: 'linux-appimage' }
    }
    default:
      return null
  }
}

/** Picks this machine's installer among a release's assets; the releases page if none matches. */
export function selectInstaller(assets: ReleaseAsset[], facts: MachineFacts): InstallerLink {
  const wanted = wantedInstaller(facts)
  if (!wanted) return RELEASES_PAGE_LINK
  const asset = assets.find(
    (a) => a.name.endsWith(wanted.suffix) && isRepoReleaseUrl(a.browser_download_url),
  )
  return asset ? { url: asset.browser_download_url, variant: wanted.variant } : RELEASES_PAGE_LINK
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetching
// ─────────────────────────────────────────────────────────────────────────────

export interface ReleaseCheckDeps {
  fetch: typeof fetch
}

const realDeps: ReleaseCheckDeps = { fetch }

type Fetched = { ok: true; release: Release } | { ok: false; reason: 'network' | 'parse' }

/** GETs one release from the GitHub API. Never throws. */
async function fetchRelease(url: string, deps: ReleaseCheckDeps): Promise<Fetched> {
  let response: Response
  try {
    response = await deps.fetch(url, { signal: AbortSignal.timeout(10_000) })
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (!response.ok) return { ok: false, reason: 'network' }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { ok: false, reason: 'parse' }
  }

  const parsed = ReleaseSchema.safeParse(json)
  if (!parsed.success || !parseVersion(parsed.data.tag_name)) return { ok: false, reason: 'parse' }
  return { ok: true, release: parsed.data }
}

/** A newer stable release, and where to download it for this machine (#66, #134). */
export interface UpdateInfo extends InstallerLink {
  latestVersion: string
}

/**
 * What the sidebar notice needs, pushed on `update:state`: a newer release (null =
 * up to date or unknown yet) and, when this is the wrong build for the hardware
 * (#133), where to get the right one (null = right build).
 */
export interface UpdateState {
  update: UpdateInfo | null
  wrongBuild: InstallerLink | null
}

export type ReleaseCheckResult =
  | { ok: true; update: UpdateInfo | null } // null = already on the latest
  | { ok: false; reason: 'network' | 'parse' }

/**
 * Checks GitHub's `/releases/latest` for a newer stable release than `currentVersion`,
 * with the download link for this machine's installer. That endpoint only ever
 * returns the latest published, non-draft, non-prerelease release — pre-releases
 * and drafts are never candidates here by design (only the app's stable "latest"
 * release counts). Never throws: a network hiccup or an unexpected response just
 * yields `{ ok: false }`, since this is a best-effort, non-critical check that must
 * never block the app.
 */
export async function checkForNewRelease(
  currentVersion: string,
  facts: MachineFacts,
  deps: ReleaseCheckDeps = realDeps,
): Promise<ReleaseCheckResult> {
  const fetched = await fetchRelease(LATEST_RELEASE_API_URL, deps)
  if (!fetched.ok) return fetched
  const { tag_name: tagName, assets } = fetched.release
  if (!isNewerVersion(tagName, currentVersion)) return { ok: true, update: null }
  return { ok: true, update: { latestVersion: tagName, ...selectInstaller(assets, facts) } }
}

/**
 * This machine's installer for the version that is already running (`vX.Y.Z` tag),
 * for the wrong-build notice (#133): the fix is the right build of the same
 * version, not only the next release. Never throws; any failure (offline, no
 * release for that tag, no matching asset) yields the releases page.
 */
export async function currentVersionInstaller(
  currentVersion: string,
  facts: MachineFacts,
  deps: ReleaseCheckDeps = realDeps,
): Promise<InstallerLink> {
  if (!parseVersion(currentVersion)) return RELEASES_PAGE_LINK
  const tag = `v${currentVersion.replace(/^v/, '')}`
  const fetched = await fetchRelease(`${RELEASES_API_URL}/tags/${tag}`, deps)
  return fetched.ok ? selectInstaller(fetched.release.assets, facts) : RELEASES_PAGE_LINK
}
