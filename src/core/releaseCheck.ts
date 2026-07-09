import { z } from 'zod'

export const GITHUB_OWNER = 'MrBurcha'
export const GITHUB_REPO = 'ClaudeTotalRecall'

const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

const LatestReleaseSchema = z.object({ tag_name: z.string() })

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

export interface ReleaseCheckDeps {
  fetch: typeof fetch
}

const realDeps: ReleaseCheckDeps = { fetch }

export type ReleaseCheckResult =
  | { ok: true; latestVersion: string | null } // null = already on the latest
  | { ok: false; reason: 'network' | 'parse' }

/** What the renderer needs to show the "update available" banner (#66), or nothing. */
export type UpdateState = { latestVersion: string; releasesUrl: string } | null

/**
 * Checks GitHub's `/releases/latest` for a newer stable release than `currentVersion`.
 * That endpoint only ever returns the latest published, non-draft, non-prerelease
 * release — pre-releases and drafts are never candidates here by design (only the
 * app's stable "latest" release counts). Never throws: a network hiccup or an
 * unexpected response just yields `{ ok: false }`, since this is a best-effort,
 * non-critical check that must never block the app.
 */
export async function checkForNewRelease(
  currentVersion: string,
  deps: ReleaseCheckDeps = realDeps,
): Promise<ReleaseCheckResult> {
  let response: Response
  try {
    response = await deps.fetch(LATEST_RELEASE_API_URL, { signal: AbortSignal.timeout(10_000) })
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

  const parsed = LatestReleaseSchema.safeParse(json)
  if (!parsed.success) return { ok: false, reason: 'parse' }

  const { tag_name: tagName } = parsed.data
  if (!parseVersion(tagName)) return { ok: false, reason: 'parse' }

  return { ok: true, latestVersion: isNewerVersion(tagName, currentVersion) ? tagName : null }
}
