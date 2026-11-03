import { run, type ExecResult } from './exec'
import { classifyRemoteError, type GitAuth, type GitEnv } from './gitAuth'
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

/** Throws GitError when `r` failed; returns its trimmed stdout. */
function checked(args: string[], r: ExecResult): string {
  if (r.code !== 0) {
    throw new GitError(`git ${args.join(' ')} failed (code ${r.code}): ${r.stderr.trim()}`, r)
  }
  return r.stdout.trim()
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
  /**
   * @param auth authenticates the network commands (fetch/pull/push/clone) — see
   *   `gitAuth.ts`; without it git uses its own credentials, as before.
   */
  constructor(
    readonly cwd: string,
    private readonly bin = 'git',
    private readonly auth?: GitAuth,
  ) {}

  /** Runs raw git; does not throw on code != 0. */
  async raw(args: string[], input?: string, env?: GitEnv): Promise<ExecResult> {
    // core.quotePath=false: emit non-ASCII paths (filenames with ñ, accents, …)
    // verbatim as UTF-8 instead of git's octal-escaped `"\NNN"` quoting, so path
    // parsing (activity feed, conflicts) and file lookup work for those names.
    return run(this.bin, ['-c', 'core.quotePath=false', ...args], { cwd: this.cwd, input, env })
  }

  /** Runs git and throws GitError if code != 0; returns trimmed stdout. */
  async out(args: string[]): Promise<string> {
    return checked(args, await this.raw(args))
  }

  /**
   * Runs a command that talks to the remote. Never prompts (a background app has no
   * terminal to answer on, and a dev-mode prompt would hang the cycle). When the
   * remote refuses access, asks `auth` for an account that can reach it and retries
   * once — the failed attempt never got past authentication, so a retry is safe.
   */
  private async net(args: string[], remote?: string, inRepo = true): Promise<ExecResult> {
    const cwd = inRepo ? this.cwd : undefined
    const url = remote ?? (await this.originUrl())
    const exec = (env?: GitEnv): Promise<ExecResult> =>
      run(this.bin, ['-c', 'core.quotePath=false', ...args], {
        cwd,
        env: { GIT_TERMINAL_PROMPT: '0', ...env },
      })
    const first = await exec(url && this.auth ? await this.auth.env(url) : undefined)
    if (first.code === 0 || !url || !this.auth) return first
    if (classifyRemoteError(first.stderr) !== 'access') return first
    const env = await this.auth.recover(url, async (candidate) => {
      const probe = await run(this.bin, ['ls-remote', url], {
        env: { GIT_TERMINAL_PROMPT: '0', ...candidate },
      })
      return probe.code === 0
    })
    return env ? exec(env) : first
  }

  private async originUrl(): Promise<string | null> {
    const r = await this.raw(['remote', 'get-url', 'origin'])
    return r.code === 0 ? r.stdout.trim() : null
  }

  static async clone(remote: string, dir: string, bin = 'git', auth?: GitAuth): Promise<Git> {
    const git = new Git(dir, bin, auth)
    // Not run inside `dir`: it doesn't exist until git creates it.
    const r = await git.net(['clone', remote, dir], remote, false)
    if (r.code !== 0) {
      throw new GitError(`git clone failed: ${r.stderr.trim()}`, r)
    }
    return git
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
      throw new GitError(`git hash-object --stdin failed (code ${r.code}): ${r.stderr.trim()}`, r)
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
    checked(['fetch'], await this.net(['fetch']))
  }

  /** Discards local commits/changes and aligns the working copy to `ref` (e.g. origin/main). */
  async resetHard(ref: string): Promise<void> {
    await this.out(['reset', '--hard', ref])
  }

  /** pull with an explicit MERGE (never rebase). Detects conflicts. */
  async pull(): Promise<PullResult> {
    const r = await this.net(['pull', '--no-rebase'])
    const conflicted = await this.listConflicts()
    if (conflicted.length > 0) return { ok: false, conflicted }
    if (r.code !== 0) {
      throw new GitError(`git pull failed: ${r.stderr.trim()}`, r)
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
    throw new GitError(`git commit -- failed (code ${r.code}): ${r.stderr.trim()}`, r)
  }

  /** push; detects a non-fast-forward rejection for the registration retry. */
  async push(args: string[] = []): Promise<PushResult> {
    const r = await this.net(['push', ...args])
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
