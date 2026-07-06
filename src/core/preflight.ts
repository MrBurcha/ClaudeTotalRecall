import { run, type ExecResult } from './exec'
import { findExecutable } from './resolvePath'
import type { PreflightCheck, PreflightResult } from './types'

/** Deps inyectables para poder testear ausencia de git/gh y gh no autenticado. */
export interface PreflightDeps {
  find: (name: string) => string | null
  exec: (bin: string, args: string[]) => Promise<ExecResult>
}

const realDeps: PreflightDeps = {
  find: (name) => findExecutable(name),
  exec: (bin, args) => run(bin, args),
}

/**
 * Verifica que git y gh estén presentes y que gh esté autenticado.
 * Guía con `fix` accionable cuando algo falta, en vez de explotar.
 */
export async function runPreflight(deps: PreflightDeps = realDeps): Promise<PreflightResult> {
  const checks: PreflightCheck[] = []

  const gitPath = deps.find('git')
  checks.push(
    gitPath
      ? { name: 'git', ok: true, detail: gitPath }
      : { name: 'git', ok: false, detail: 'git no encontrado en el PATH', fix: 'Instalá git' },
  )

  const ghPath = deps.find('gh')
  checks.push(
    ghPath
      ? { name: 'gh', ok: true, detail: ghPath }
      : {
          name: 'gh',
          ok: false,
          detail: 'gh (GitHub CLI) no encontrado',
          fix: 'Instalá gh desde https://cli.github.com',
        },
  )

  if (ghPath) {
    const r = await deps.exec('gh', ['auth', 'status'])
    checks.push(
      r.code === 0
        ? { name: 'gh-auth', ok: true, detail: 'gh autenticado' }
        : {
            name: 'gh-auth',
            ok: false,
            detail: (r.stderr || r.stdout).trim(),
            fix: 'Ejecutá: gh auth login && gh auth setup-git',
          },
    )
  } else {
    checks.push({
      name: 'gh-auth',
      ok: false,
      detail: 'gh no está instalado, no se puede verificar la auth',
      fix: 'Instalá gh primero',
    })
  }

  return { ok: checks.every((c) => c.ok), checks }
}
