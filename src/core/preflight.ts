import { run, type ExecResult } from './exec'
import { findExecutable } from './resolvePath'
import type { PreflightCheck, PreflightResult } from './types'

/** Injectable deps so we can test missing/broken git/gh and an unauthenticated gh. */
export interface PreflightDeps {
  find: (name: string) => string | null
  exec: (bin: string, args: string[]) => Promise<ExecResult>
}

const realDeps: PreflightDeps = {
  find: (name) => findExecutable(name),
  exec: (bin, args) => run(bin, args),
}

/** Outcome of actually starting a binary, not just finding it on disk (#133). */
type Probe = { ok: true; version: string } | { ok: false; error: string }

/** Message of a spawn failure (ENOENT, EACCES, "Bad CPU type", …). */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Runs `<bin> --version`. A binary that is found but can't start, or exits
 * non-zero (e.g. git under Rosetta failing to load an arm64-only libxcrun), fails
 * with its real stderr so the user sees why instead of a later, silent "Offline".
 */
async function probe(deps: PreflightDeps, bin: string): Promise<Probe> {
  try {
    const r = await deps.exec(bin, ['--version'])
    if (r.code === 0) return { ok: true, version: r.stdout.trim().split(/\r?\n/)[0] ?? '' }
    return { ok: false, error: (r.stderr || r.stdout).trim() || `exited with code ${r.code}` }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/** The check for a binary that was found: OK with its version, or the reason it can't run. */
function binaryCheck(name: 'git' | 'gh', binPath: string, p: Probe): PreflightCheck {
  if (p.ok) return { name, ok: true, detail: p.version ? `${binPath} (${p.version})` : binPath }
  return {
    name,
    ok: false,
    detail: `${name} was found at ${binPath} but cannot run: ${p.error}`,
    detailKey: `${name}.cannotRun`,
    fix: `Check that "${name} --version" works in a terminal, and reinstall ${name} if it doesn't`,
    fixKey: `${name}.fixCannotRun`,
    params: { path: binPath, error: p.error },
  }
}

/**
 * Checks that git and gh are present AND start, and that gh is authenticated.
 * Guides with an actionable `fix` when something is wrong instead of blowing up.
 *
 * `detail`/`fix` carry the English default; `detailKey`/`fixKey` let the renderer
 * localize them. The resolved binary path and the raw stderr stay literal.
 */
export async function runPreflight(deps: PreflightDeps = realDeps): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []

  const gitPath = deps.find('git')
  const ghPath = deps.find('gh')
  const [gitProbe, ghProbe] = await Promise.all([
    gitPath ? probe(deps, 'git') : null,
    ghPath ? probe(deps, 'gh') : null,
  ])

  checks.push(
    gitPath && gitProbe
      ? binaryCheck('git', gitPath, gitProbe)
      : {
          name: 'git',
          ok: false,
          detail: 'git not found in PATH',
          detailKey: 'git.missing',
          fix: 'Install git',
          fixKey: 'git.install',
        },
  )

  checks.push(
    ghPath && ghProbe
      ? binaryCheck('gh', ghPath, ghProbe)
      : {
          name: 'gh',
          ok: false,
          detail: 'gh (GitHub CLI) not found',
          detailKey: 'gh.missing',
          fix: 'Install gh from https://cli.github.com',
          fixKey: 'gh.install',
        },
  )

  checks.push(await ghAuthCheck(deps, ghPath, ghProbe))

  return { ok: checks.every((c) => c.ok), checks }
}

async function ghAuthCheck(
  deps: PreflightDeps,
  ghPath: string | null,
  ghProbe: Probe | null,
): Promise<PreflightCheck> {
  if (!ghPath) {
    return {
      name: 'gh-auth',
      ok: false,
      detail: 'gh is not installed, cannot verify auth',
      detailKey: 'ghAuth.noGh',
      fix: 'Install gh first',
      fixKey: 'ghAuth.installFirst',
    }
  }
  if (!ghProbe?.ok) {
    return {
      name: 'gh-auth',
      ok: false,
      detail: 'gh cannot run, cannot verify auth',
      detailKey: 'ghAuth.ghCannotRun',
      fix: 'Fix gh first',
      fixKey: 'ghAuth.fixGhFirst',
    }
  }
  const authFix = { fix: 'Run: gh auth login && gh auth setup-git', fixKey: 'ghAuth.fix' }
  try {
    const r = await deps.exec('gh', ['auth', 'status'])
    if (r.code === 0) {
      return { name: 'gh-auth', ok: true, detail: 'gh authenticated', detailKey: 'ghAuth.ok' }
    }
    // Raw gh output, kept literal.
    return { name: 'gh-auth', ok: false, detail: (r.stderr || r.stdout).trim(), ...authFix }
  } catch (e) {
    return { name: 'gh-auth', ok: false, detail: errorText(e), ...authFix }
  }
}
