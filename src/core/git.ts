import { run, type ExecResult } from './exec'
import type { FileChange, RepoStatus } from './types'

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
  /** true if the pull (merge) came out clean; false if there are conflicts to resolve */
  ok: boolean
  conflicted: string[]
}

export interface PushResult {
  ok: boolean
  /** true if the remote rejected as non-fast-forward (another machine pushed first) */
  rejected: boolean
  stderr: string
}

export interface CommitResult {
  /** false if there was nothing to commit (clean working tree) */
  committed: boolean
}

export interface RawLogEntry {
  hash: string
  /** ISO author date (%aI) */
  at: string
  author: string
  subject: string
  /** number of changed files (= changes.length) */
  files: number
  /** files touched by the commit (from --name-status) */
  changes: FileChange[]
}

/** Maps git's status letter (A/M/D/R###/C###/T) to the semantic status. */
function fileStatus(code: string): FileChange['status'] {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'other'
  }
}

// `git log` format shared by `log()` and `logRange()`. The record separator
// (REC) goes at the START so each block reads "<header>\n<name-status…>";
// the header fields are separated by US (\x1f).
const LOG_SEP = '\x1f'
const LOG_REC = '\x1e'
const LOG_FMT = `${LOG_REC}%H${LOG_SEP}%aI${LOG_SEP}%an${LOG_SEP}%s`

/** Parses `git log --name-status` output in {@link LOG_FMT} into RawLogEntry[]. */
function parseLog(stdout: string): RawLogEntry[] {
  const out: RawLogEntry[] = []
  for (const rec of stdout.split(LOG_REC)) {
    if (!rec.trim()) continue
    const lines = rec.split('\n')
    const [hash, at, author, subject] = lines[0].split(LOG_SEP)
    if (!hash) continue
    // name-status rows: "<A|M|D|R###|C###>\t<path>[\t<newpath>]" — one per changed file.
    const changes: FileChange[] = []
    for (const line of lines.slice(1)) {
      if (!line.includes('\t')) continue
      const cols = line.split('\t')
      changes.push({ status: fileStatus(cols[0]), path: cols[cols.length - 1] })
    }
    out.push({ hash, at, author, subject: subject ?? '', files: changes.length, changes })
  }
  return out
}

/**
 * Thin git wrapper bound to a working copy (cwd). Conflict policy =
 * MERGE (not rebase): in a conflict "ours" = local (HEAD) and "theirs" = remote
 * (MERGE_HEAD), which is the intuitive mapping for the per-file UI.
 */
export class Git {
  constructor(
    readonly cwd: string,
    private readonly bin = 'git',
  ) {}

  /** Runs raw git; does not throw on code != 0. */
  async raw(args: string[], input?: string): Promise<ExecResult> {
    // core.quotePath=false: emit non-ASCII paths (filenames with ñ, accents, …)
    // verbatim as UTF-8 instead of git's octal-escaped `"\NNN"` quoting, so path
    // parsing (activity feed, conflicts) and file lookup work for those names.
    return run(this.bin, ['-c', 'core.quotePath=false', ...args], { cwd: this.cwd, input })
  }

  /** Runs git and throws GitError if code != 0; returns trimmed stdout. */
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

  /** True while a merge is in progress (MERGE_HEAD exists), resolved or not. */
  async mergeInProgress(): Promise<boolean> {
    const r = await this.raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    return r.code === 0
  }

  /** Object id of `path` (repo-relative, posix) as of `rev`, or null when it isn't there. */
  async blobId(rev: string, path: string): Promise<string | null> {
    const r = await this.raw(['rev-parse', '-q', '--verify', `${rev}:${path}`])
    return r.code === 0 ? r.stdout.trim() : null
  }

  /**
   * Object id git would give some bytes — a file on disk (read byte-exact, no
   * filters) or a string — comparable with `blobId` without decoding blobs.
   */
  async hashObject(src: { file: string } | { content: string }): Promise<string> {
    if ('file' in src) return this.out(['hash-object', '--no-filters', '--', src.file])
    const r = await this.raw(['hash-object', '--no-filters', '--stdin'], src.content)
    if (r.code !== 0) {
      throw new GitError(`git hash-object --stdin falló (code ${r.code}): ${r.stderr.trim()}`, r)
    }
    return r.stdout.trim()
  }

  /** Tracked files under the given pathspecs (repo-relative); [] when none match. */
  async lsFiles(paths: string[]): Promise<string[]> {
    const out = await this.out(['ls-files', '-z', '--', ...paths])
    return out.split('\0').filter(Boolean)
  }

  /**
   * `git rm` from the index AND the working tree. `recursive` for directories,
   * `force` to drop files even when they carry local modifications. Paths that
   * match nothing are ignored, so it is safe to call on an already-clean tree.
   */
  async rm(paths: string[], opts: { recursive?: boolean; force?: boolean } = {}): Promise<void> {
    const flags = ['-q', '--ignore-unmatch']
    if (opts.recursive) flags.push('-r')
    if (opts.force) flags.push('-f')
    await this.out(['rm', ...flags, '--', ...paths])
  }

  /**
   * Which sides of a merge conflict still have `file`, read from the index stages
   * (`ls-files -u`: 2 = ours/local, 3 = theirs/remote). A modify/delete conflict
   * lacks one of them — that side DELETED the file (#136).
   */
  async conflictSides(file: string): Promise<{ ours: boolean; theirs: boolean }> {
    const out = await this.out(['ls-files', '-u', '-z', '--', file])
    const stages = new Set<string>()
    for (const entry of out.split('\0')) {
      // "<mode> <sha> <stage>\t<path>"
      const stage = entry.split('\t')[0]?.split(' ')[2]
      if (stage) stages.add(stage)
    }
    return { ours: stages.has('2'), theirs: stages.has('3') }
  }

  async isDirty(): Promise<boolean> {
    const out = await this.out(['status', '--porcelain'])
    return out.length > 0
  }

  /** ahead/behind relative to the upstream; 0/0 if no upstream is configured. */
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
   * Last `limit` commits with file counts. Uses `raw` (doesn't throw) to
   * tolerate a repo with no commits → [].
   */
  async log(limit = 50): Promise<RawLogEntry[]> {
    const r = await this.raw(['log', `-n${limit}`, '--name-status', `--pretty=format:${LOG_FMT}`])
    if (r.code !== 0) return []
    return parseLog(r.stdout)
  }

  /**
   * Commits in the range `(fromExclusive, toInclusive]`, same format as `log()`.
   * Used to attribute an incoming: the commits the pull brought in between the
   * last recorded HEAD and the current one. [] if the range is invalid/empty.
   */
  async logRange(fromExclusive: string, toInclusive: string): Promise<RawLogEntry[]> {
    const r = await this.raw([
      'log',
      `${fromExclusive}..${toInclusive}`,
      '--name-status',
      `--pretty=format:${LOG_FMT}`,
    ])
    if (r.code !== 0) return []
    return parseLog(r.stdout)
  }

  /** Resolves a ref to its full hash, or null (e.g. a repo with no commits yet). */
  async revParse(ref = 'HEAD'): Promise<string | null> {
    const r = await this.raw(['rev-parse', ref])
    return r.code === 0 ? r.stdout.trim() : null
  }

  async fetch(): Promise<void> {
    await this.out(['fetch'])
  }

  /** Discards local commits/changes and aligns the working copy to `ref` (e.g. origin/main). */
  async resetHard(ref: string): Promise<void> {
    await this.out(['reset', '--hard', ref])
  }

  /** pull with an explicit MERGE (never rebase). Detects conflicts. */
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

  /** Commits; if the working tree is clean, returns { committed: false }. */
  async commit(message: string): Promise<CommitResult> {
    if (!(await this.isDirty())) return { committed: false }
    await this.out(['commit', '-m', message])
    return { committed: true }
  }

  /**
   * Commit LIMITED to a pathspec: records only changes under `paths`, ignoring
   * anything else staged in the index (a git "partial commit"). Keeps a Notebook
   * save from sweeping in a concurrent flow's staged changes. No-op if the pathspec
   * has nothing to commit.
   */
  async commitPaths(message: string, paths: string[]): Promise<CommitResult> {
    const r = await this.raw(['commit', '-m', message, '--', ...paths])
    if (r.code === 0) return { committed: true }
    if (/nothing to commit|no changes added|did not match/i.test(`${r.stdout}\n${r.stderr}`)) {
      return { committed: false }
    }
    throw new GitError(`git commit -- falló (code ${r.code}): ${r.stderr.trim()}`, r)
  }

  /** push; detects a non-fast-forward rejection for the registration retry. */
  async push(args: string[] = []): Promise<PushResult> {
    const r = await this.raw(['push', ...args])
    if (r.code === 0) return { ok: true, rejected: false, stderr: r.stderr }
    const rejected = /\b(rejected|non-fast-forward|fetch first)\b/i.test(r.stderr)
    return { ok: false, rejected, stderr: r.stderr }
  }

  // ── Conflict resolution (merge: ours=local, theirs=remote) ───────────────────
  // These only work when that side HAS the file; `core/conflict.ts` picks `rm`
  // instead for the side of a modify/delete conflict that deleted it (#136).
  async checkoutOurs(file: string): Promise<void> {
    await this.out(['checkout', '--ours', '--', file])
    await this.add([file])
  }

  async checkoutTheirs(file: string): Promise<void> {
    await this.out(['checkout', '--theirs', '--', file])
    await this.add([file])
  }

  /** Completes the merge in progress (once every conflict is resolved). */
  async completeMerge(message?: string): Promise<void> {
    const args = message ? ['commit', '-m', message] : ['commit', '--no-edit']
    await this.out(args)
  }

  async config(key: string, value: string): Promise<void> {
    await this.out(['config', key, value])
  }
}
