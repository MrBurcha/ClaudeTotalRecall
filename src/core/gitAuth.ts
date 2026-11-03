import { run, type ExecResult } from './exec'
import type { RemoteErrorKind } from './types'

/**
 * GitHub access that does NOT depend on which `gh` account is active.
 *
 * git authenticates to GitHub through `gh auth git-credential`, which always answers
 * with the ACTIVE gh account's token (it even refuses when git asks for a specific
 * username). A user with a personal and a work account who runs `gh auth switch` for
 * their day job silently cut this app off from the memories repo — every cycle failed
 * with "Repository not found" and the UI just said "Offline".
 *
 * So after a network git command fails for lack of access, we try each account gh is
 * logged into (`gh auth token --user <login>`), keep the first one that can reach the
 * remote, and remember it per machine. From then on every network git command runs as
 * that account, whatever is active. The active account is never changed.
 */

export type GitEnv = Record<string, string>

// Access checks run first: `unable to access '<url>'` prefixes both families, and an
// HTTP 401/403 is the remote answering, not the network failing.
const ACCESS_PATTERNS = [
  /repository not found/i,
  /authentication failed/i,
  /could not read (username|password)/i,
  /terminal prompts disabled/i,
  /returned error: 40[13]\b/i,
  /permission to \S+ denied/i,
  /invalid username or (password|token)/i,
  /permission denied \(publickey/i,
  /\bwrite access to repository not granted\b/i,
]

const NETWORK_PATTERNS = [
  /could not resolve (host|hostname|proxy)/i,
  /failed to connect to/i,
  /connection (timed out|refused|reset|closed)/i,
  /operation timed out/i,
  /network is (unreachable|down)/i,
  /no route to host/i,
  /temporary failure in name resolution/i,
  /\b(ssl|tls)\b[^\n]*(error|handshake|certificate|connect)/i,
  /gnutls_handshake/i,
  /the remote end hung up unexpectedly/i,
]

/** Classifies a remote git failure from its stderr / error message. */
export function classifyRemoteError(text: string): RemoteErrorKind {
  if (ACCESS_PATTERNS.some((re) => re.test(text))) return 'access'
  if (NETWORK_PATTERNS.some((re) => re.test(text))) return 'network'
  return 'other'
}

/** True for an https remote on github.com (the only host this account fallback handles). */
export function isGithubHttpsRemote(url: string): boolean {
  return /^https:\/\/([^@/]+@)?github\.com(:443)?\//i.test(url.trim())
}

/**
 * Logins gh is signed into on github.com, parsed from `gh auth status`. Handles both
 * output generations: "Logged in to github.com account <login>" (gh ≥ 2.40, many
 * accounts) and "Logged in to github.com as <login>" (older, one account).
 */
export function parseGhAccounts(text: string): string[] {
  const users: string[] = []
  for (const m of text.matchAll(/Logged in to github\.com (?:account|as) ([A-Za-z0-9-]+)/g)) {
    if (!users.includes(m[1])) users.push(m[1])
  }
  return users
}

/**
 * Env that makes a git child authenticate as the given token: `GH_TOKEN` is what
 * `gh auth git-credential` hands to git, and the `GIT_CONFIG_*` pair resets the
 * credential helpers to gh alone (command-line scope, so it overrides the user's
 * config) — the pinned account works even if the machine's git config uses another
 * helper. The token never goes into argv.
 */
export function tokenEnv(token: string): GitEnv {
  return {
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '!gh auth git-credential',
  }
}

/** Plugged into `Git` to authenticate its network commands. */
export interface GitAuth {
  /** Extra env for a network command against `remote`; undefined = git's own credentials. */
  env(remote: string): Promise<GitEnv | undefined>
  /**
   * Called after a network command failed for lack of access: finds an account that
   * can reach `remote` (checked with `canReach`), remembers it, and returns its env.
   */
  recover(remote: string, canReach: (env: GitEnv) => Promise<boolean>): Promise<GitEnv | undefined>
}

/** Where the chosen account is remembered (per machine, outside the repo). */
export interface AccountStore {
  load(): Promise<string | undefined>
  save(login: string): Promise<void>
}

export type GhRunner = (args: string[]) => Promise<ExecResult>

const realGh: GhRunner = (args) => run('gh', args)

/** {@link GitAuth} backed by the accounts the GitHub CLI is logged into. */
export class GhAccountAuth implements GitAuth {
  constructor(
    private readonly store: AccountStore,
    private readonly gh: GhRunner = realGh,
  ) {}

  async env(remote: string): Promise<GitEnv | undefined> {
    if (!isGithubHttpsRemote(remote)) return undefined
    const login = await this.store.load().catch(() => undefined)
    // No account remembered: leave git alone (the active account, as always).
    if (!login) return undefined
    return this.envFor(login)
  }

  async recover(
    remote: string,
    canReach: (env: GitEnv) => Promise<boolean>,
  ): Promise<GitEnv | undefined> {
    if (!isGithubHttpsRemote(remote)) return undefined
    const status = await this.call(['auth', 'status', '--hostname', 'github.com'])
    // gh exits non-zero when ANY account has a problem; the healthy ones are still listed.
    const logins = status ? parseGhAccounts(`${status.stdout}\n${status.stderr}`) : []
    for (const login of logins) {
      const env = await this.envFor(login)
      if (env && (await canReach(env))) {
        await this.store.save(login).catch(() => undefined)
        return env
      }
    }
    return undefined
  }

  private async envFor(login: string): Promise<GitEnv | undefined> {
    // `--user` needs gh ≥ 2.40; on an older gh this fails and we fall back to git's own.
    const r = await this.call(['auth', 'token', '--hostname', 'github.com', '--user', login])
    const token = r && r.code === 0 ? r.stdout.trim() : ''
    return token ? tokenEnv(token) : undefined
  }

  private async call(args: string[]): Promise<ExecResult | null> {
    try {
      return await this.gh(args)
    } catch {
      return null // gh missing / not runnable
    }
  }
}
