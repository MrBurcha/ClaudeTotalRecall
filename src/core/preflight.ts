import { run, type ExecResult } from './exec'
import { findExecutable } from './resolvePath'
import type { PreflightCheck, PreflightResult } from './types'

/** Injectable deps so we can test missing git/gh and an unauthenticated gh. */
export interface PreflightDeps {
  find: (name: string) => string | null
  exec: (bin: string, args: string[]) => Promise<ExecResult>
}

const realDeps: PreflightDeps = {
  find: (name) => findExecutable(name),
  exec: (bin, args) => run(bin, args),
}

/**
 * Checks that git and gh are present and that gh is authenticated. Guides with an
 * actionable `fix` when something is missing instead of blowing up.
 *
 * `detail`/`fix` carry the English default; `detailKey`/`fixKey` let the renderer
 * localize them. The resolved binary path and the raw gh stderr stay literal.
 */
export async function runPreflight(deps: PreflightDeps = realDeps): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []

  const gitPath = deps.find('git')
  checks.push(
    gitPath
      ? { name: 'git', ok: true, detail: gitPath }
      : {
          name: 'git',
          ok: false,
          detail: 'git not found in PATH',
          detailKey: 'git.missing',
          fix: 'Install git',
          fixKey: 'git.install',
        },
  )

  const ghPath = deps.find('gh')
  checks.push(
    ghPath
      ? { name: 'gh', ok: true, detail: ghPath }
      : {
          name: 'gh',
          ok: false,
          detail: 'gh (GitHub CLI) not found',
          detailKey: 'gh.missing',
          fix: 'Install gh from https://cli.github.com',
          fixKey: 'gh.install',
        },
  )

  if (ghPath) {
    const r = await deps.exec('gh', ['auth', 'status'])
    checks.push(
      r.code === 0
        ? { name: 'gh-auth', ok: true, detail: 'gh authenticated', detailKey: 'ghAuth.ok' }
        : {
            name: 'gh-auth',
            ok: false,
            detail: (r.stderr || r.stdout).trim(), // raw gh output, kept literal
            fix: 'Run: gh auth login && gh auth setup-git',
            fixKey: 'ghAuth.fix',
          },
    )
  } else {
    checks.push({
      name: 'gh-auth',
      ok: false,
      detail: 'gh is not installed, cannot verify auth',
      detailKey: 'ghAuth.noGh',
      fix: 'Install gh first',
      fixKey: 'ghAuth.installFirst',
    })
  }

  return { ok: checks.every((c) => c.ok), checks }
}
