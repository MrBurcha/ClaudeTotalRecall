import { run, type ExecResult } from './exec'
import type { RepoStatus } from './types'

export class GitError extends Error {
  constructor(
    message: string,
    readonly result: ExecResult,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface PullResult {
  /** true si el pull (merge) quedó limpio; false si hay conflictos por resolver */
  ok: boolean
  conflicted: string[]
}

export interface PushResult {
  ok: boolean
  /** true si el remoto rechazó por non-fast-forward (otra máquina empujó primero) */
  rejected: boolean
  stderr: string
}

export interface CommitResult {
  /** false si no había nada para commitear (working tree limpio) */
  committed: boolean
}

export interface RawLogEntry {
  hash: string
  /** ISO author date (%aI) */
  at: string
  author: string
  subject: string
  /** número de archivos cambiados (líneas de --numstat) */
  files: number
}

/**
 * Wrapper fino de git ligado a un working copy (cwd). Política de conflictos =
 * MERGE (no rebase): en un conflicto "ours" = local (HEAD) y "theirs" = remoto
 * (MERGE_HEAD), que es el mapeo intuitivo para la UI por-archivo.
 */
export class Git {
  constructor(
    readonly cwd: string,
    private readonly bin = 'git',
  ) {}

  /** Ejecuta git crudo; no tira por code != 0. */
  async raw(args: string[], input?: string): Promise<ExecResult> {
    return run(this.bin, args, { cwd: this.cwd, input })
  }

  /** Ejecuta git y tira GitError si code != 0; devuelve stdout trimmeado. */
  async out(args: string[]): Promise<string> {
    const r = await this.raw(args)
    if (r.code !== 0) {
      throw new GitError(`git ${args.join(' ')} falló (code ${r.code}): ${r.stderr.trim()}`, r)
    }
    return r.stdout.trim()
  }

  static async clone(remote: string, dir: string, bin = 'git'): Promise<Git> {
    const r = await run(bin, ['clone', remote, dir])
    if (r.code !== 0) {
      throw new GitError(`git clone falló: ${r.stderr.trim()}`, r)
    }
    return new Git(dir, bin)
  }

  async init(): Promise<void> {
    await this.out(['init'])
  }

  async currentBranch(): Promise<string> {
    return this.out(['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  async listConflicts(): Promise<string[]> {
    const out = await this.out(['diff', '--name-only', '--diff-filter=U'])
    return out ? out.split('\n').filter(Boolean) : []
  }

  async isDirty(): Promise<boolean> {
    const out = await this.out(['status', '--porcelain'])
    return out.length > 0
  }

  /** ahead/behind respecto del upstream; 0/0 si no hay upstream configurado. */
  private async aheadBehind(): Promise<{ ahead: number; behind: number }> {
    // left = upstream, right = HEAD → "<behind>\t<ahead>"
    const r = await this.raw(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    if (r.code !== 0) return { ahead: 0, behind: 0 }
    const [behind, ahead] = r.stdout.trim().split(/\s+/).map(Number)
    return { ahead: ahead || 0, behind: behind || 0 }
  }

  async status(): Promise<RepoStatus> {
    const branch = await this.currentBranch()
    const dirty = await this.isDirty()
    const conflicted = await this.listConflicts()
    const { ahead, behind } = await this.aheadBehind()
    return { branch, ahead, behind, dirty, conflicted }
  }

  /**
   * Últimos `limit` commits con conteo de archivos. Usa `raw` (no tira) para
   * tolerar un repo sin commits → []. El separador de registro va al INICIO del
   * formato así cada bloque queda como "<header>\n<numstat…>" (header + sus líneas
   * de --numstat juntas); los campos van separados por US (\x1f).
   */
  async log(limit = 50): Promise<RawLogEntry[]> {
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = `${REC}%H${SEP}%aI${SEP}%an${SEP}%s`
    const r = await this.raw(['log', `-n${limit}`, '--numstat', `--pretty=format:${fmt}`])
    if (r.code !== 0) return []
    const out: RawLogEntry[] = []
    for (const rec of r.stdout.split(REC)) {
      if (!rec.trim()) continue
      const lines = rec.split('\n')
      const [hash, at, author, subject] = lines[0].split(SEP)
      if (!hash) continue
      // numstat lines look like "added\tdeleted\tpath" — one per changed file.
      const files = lines.slice(1).filter((l) => l.includes('\t')).length
      out.push({ hash, at, author, subject: subject ?? '', files })
    }
    return out
  }

  async fetch(): Promise<void> {
    await this.out(['fetch'])
  }

  /** Descarta commits/cambios locales y alinea el working copy a `ref` (p.ej. origin/main). */
  async resetHard(ref: string): Promise<void> {
    await this.out(['reset', '--hard', ref])
  }

  /** pull con MERGE explícito (nunca rebase). Detecta conflictos. */
  async pull(): Promise<PullResult> {
    const r = await this.raw(['pull', '--no-rebase'])
    const conflicted = await this.listConflicts()
    if (conflicted.length > 0) return { ok: false, conflicted }
    if (r.code !== 0) {
      throw new GitError(`git pull falló: ${r.stderr.trim()}`, r)
    }
    return { ok: true, conflicted: [] }
  }

  async add(paths: string[] = ['-A']): Promise<void> {
    await this.out(['add', ...paths])
  }

  /** Commitea; si el working tree está limpio devuelve { committed: false }. */
  async commit(message: string): Promise<CommitResult> {
    if (!(await this.isDirty())) return { committed: false }
    await this.out(['commit', '-m', message])
    return { committed: true }
  }

  /** push; detecta rechazo por non-fast-forward para el retry del registro. */
  async push(args: string[] = []): Promise<PushResult> {
    const r = await this.raw(['push', ...args])
    if (r.code === 0) return { ok: true, rejected: false, stderr: r.stderr }
    const rejected = /\b(rejected|non-fast-forward|fetch first)\b/i.test(r.stderr)
    return { ok: false, rejected, stderr: r.stderr }
  }

  // ── Resolución de conflictos (merge: ours=local, theirs=remoto) ──────────────
  async checkoutOurs(file: string): Promise<void> {
    await this.out(['checkout', '--ours', '--', file])
    await this.add([file])
  }

  async checkoutTheirs(file: string): Promise<void> {
    await this.out(['checkout', '--theirs', '--', file])
    await this.add([file])
  }

  /** Cierra el merge en curso (tras resolver todos los conflictos). */
  async completeMerge(message?: string): Promise<void> {
    const args = message ? ['commit', '-m', message] : ['commit', '--no-edit']
    await this.out(args)
  }

  async config(key: string, value: string): Promise<void> {
    await this.out(['config', key, value])
  }
}
