import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run, type ExecResult } from './exec'
import { Git } from './git'
import {
  classifyRemoteError,
  GhAccountAuth,
  isGithubHttpsRemote,
  parseGhAccounts,
  tokenEnv,
  type AccountStore,
  type GitAuth,
  type GitEnv,
} from './gitAuth'

const REMOTE = 'https://github.com/owner/claude-memory.git'

// Real stderr captured from a machine whose active gh account couldn't see the repo.
const NOT_FOUND = [
  'remote: Repository not found.',
  "fatal: repository 'https://github.com/MrBurcha/claude-memory.git/' not found",
].join('\n')

describe('classifyRemoteError', () => {
  it.each([
    [NOT_FOUND, 'access'],
    [
      "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
      'access',
    ],
    ["remote: Permission to o/r.git denied to someone.\nfatal: unable to access 'x'", 'access'],
    [
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      'access',
    ],
    ['git@github.com: Permission denied (publickey).', 'access'],
    [
      "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
      'network',
    ],
    [
      "fatal: unable to access 'x': Failed to connect to github.com port 443 after 75000 ms",
      'network',
    ],
    ['ssh: connect to host github.com port 22: Operation timed out', 'network'],
    ["fatal: unable to access 'x': SSL certificate problem: unable to get local issuer", 'network'],
    ['git commit failed (code 1): error: unable to write file memories/tls/x.md', 'other'],
    ["ENOENT: no such file or directory, open '/x/claudetr.json'", 'other'],
  ])('%s → %s', (text, kind) => {
    expect(classifyRemoteError(text)).toBe(kind)
  })
})

describe('isGithubHttpsRemote', () => {
  it('accepts github.com https remotes, with or without a username', () => {
    expect(isGithubHttpsRemote(REMOTE)).toBe(true)
    expect(isGithubHttpsRemote('https://someone@github.com/o/r')).toBe(true)
  })
  it('rejects ssh, other hosts and local remotes', () => {
    expect(isGithubHttpsRemote('git@github.com:o/r.git')).toBe(false)
    expect(isGithubHttpsRemote('https://gitlab.com/o/r.git')).toBe(false)
    expect(isGithubHttpsRemote('https://github.com.evil.example/o/r')).toBe(false)
    expect(isGithubHttpsRemote('file:///tmp/remote.git')).toBe(false)
  })
})

describe('parseGhAccounts', () => {
  it('lists every account of a multi-account gh (≥ 2.40), in order', () => {
    const out = [
      'github.com',
      '  ✓ Logged in to github.com account work-login (keyring)',
      '  - Active account: true',
      '  ✓ Logged in to github.com account Personal-1 (keyring)',
      '  - Active account: false',
    ].join('\n')
    expect(parseGhAccounts(out)).toEqual(['work-login', 'Personal-1'])
  })
  it('understands the older single-account wording', () => {
    expect(parseGhAccounts('  ✓ Logged in to github.com as someone (oauth_token)')).toEqual([
      'someone',
    ])
  })
  it('returns nothing when gh is logged out', () => {
    expect(parseGhAccounts('You are not logged into any GitHub hosts.')).toEqual([])
  })
})

/** In-memory store + a fake gh that knows a token per login. */
function harness(opts: { pinned?: string; tokens: Record<string, string>; status?: string }): {
  store: AccountStore & { saved: string[] }
  calls: string[][]
  auth: GhAccountAuth
} {
  let pinned = opts.pinned
  const store = {
    saved: [] as string[],
    load: async () => pinned,
    save: async (login: string) => {
      pinned = login
      store.saved.push(login)
    },
  }
  const calls: string[][] = []
  const gh = async (args: string[]): Promise<ExecResult> => {
    calls.push(args)
    if (args[1] === 'status') {
      const status =
        opts.status ??
        Object.keys(opts.tokens)
          .map((l) => `  ✓ Logged in to github.com account ${l} (keyring)`)
          .join('\n')
      return { code: 0, stdout: status, stderr: '' }
    }
    const login = args[args.indexOf('--user') + 1]
    const token = opts.tokens[login]
    return token
      ? { code: 0, stdout: `${token}\n`, stderr: '' }
      : { code: 1, stdout: '', stderr: 'no' }
  }
  return { store, calls, auth: new GhAccountAuth(store, gh) }
}

describe('GhAccountAuth', () => {
  it('leaves git alone while no account is remembered', async () => {
    const { auth, calls } = harness({ tokens: { a: 'ta' } })
    expect(await auth.env(REMOTE)).toBeUndefined()
    expect(calls).toEqual([])
  })

  it("runs as the remembered account's token, whichever account is active", async () => {
    const { auth } = harness({ pinned: 'personal', tokens: { work: 'tw', personal: 'tp' } })
    expect(await auth.env(REMOTE)).toEqual(tokenEnv('tp'))
  })

  it('falls back to git defaults when the remembered account is gone from gh', async () => {
    const { auth } = harness({ pinned: 'gone', tokens: { work: 'tw' } })
    expect(await auth.env(REMOTE)).toBeUndefined()
  })

  it('recover: tries each account, remembers the first that reaches the remote', async () => {
    const { auth, store } = harness({ tokens: { work: 'tw', personal: 'tp', other: 'to' } })
    const tried: string[] = []
    const env = await auth.recover(REMOTE, async (e: GitEnv) => {
      tried.push(e.GH_TOKEN)
      return e.GH_TOKEN === 'tp'
    })
    expect(env).toEqual(tokenEnv('tp'))
    expect(tried).toEqual(['tw', 'tp'])
    expect(store.saved).toEqual(['personal'])
  })

  it('recover: undefined (and remembers nothing) when no account can reach it', async () => {
    const { auth, store } = harness({ tokens: { work: 'tw' } })
    expect(await auth.recover(REMOTE, async () => false)).toBeUndefined()
    expect(store.saved).toEqual([])
  })

  it('never touches non-GitHub or ssh remotes', async () => {
    const { auth, calls } = harness({ pinned: 'p', tokens: { p: 'tp' } })
    expect(await auth.env('git@github.com:o/r.git')).toBeUndefined()
    expect(await auth.recover('file:///tmp/r.git', async () => true)).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('survives gh not being installed', async () => {
    const auth = new GhAccountAuth(
      { load: async () => 'p', save: async () => undefined },
      async () => {
        throw new Error('spawn gh ENOENT')
      },
    )
    expect(await auth.env(REMOTE)).toBeUndefined()
    expect(await auth.recover(REMOTE, async () => true)).toBeUndefined()
  })

  it('tokenEnv resets the credential helpers to gh and keeps the token out of argv', () => {
    const env = tokenEnv('secret')
    expect(env.GH_TOKEN).toBe('secret')
    expect(env.GIT_CONFIG_VALUE_0).toBe('')
    expect(env.GIT_CONFIG_VALUE_1).toBe('!gh auth git-credential')
  })
})

// ── Git: network commands retry once with a recovered account ───────────────────
// A wrapper around the real git plays GitHub: without GH_TOKEN=good it answers like
// a repo the active account can't see; with it, it's plain git on a file:// remote.
describe.skipIf(process.platform === 'win32')('Git network auth', () => {
  let root: string
  let fakeGit: string
  let remote: string
  let realGit: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ctr-gitauth-'))
    realGit = (await run('sh', ['-c', 'command -v git'])).stdout.trim()
    fakeGit = join(root, 'fake-git.sh')
    await writeFile(
      fakeGit,
      [
        '#!/bin/sh',
        'echo "$GIT_TERMINAL_PROMPT" >> "$(dirname "$0")/prompt.log"',
        'case " $* " in',
        '  *" fetch "*|*" pull "*|*" push "*|*" ls-remote "*|*" clone "*)',
        '    if [ "$GH_TOKEN" != "good" ]; then',
        '      echo "remote: Repository not found." >&2',
        '      echo "fatal: repository \'https://github.com/o/r.git/\' not found" >&2',
        '      exit 128',
        '    fi',
        'esac',
        `exec "${realGit}" "$@"`,
      ].join('\n'),
    )
    await chmod(fakeGit, 0o755)
    remote = join(root, 'remote.git')
    await run(realGit, ['init', '--bare', '-b', 'main', remote])
    const seed = join(root, 'seed')
    await run(realGit, ['clone', remote, seed])
    await writeFile(join(seed, 'a.txt'), 'a\n')
    await run(realGit, ['-C', seed, 'add', '.'])
    await run(realGit, [
      '-C',
      seed,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-m',
      'a',
    ])
    await run(realGit, ['-C', seed, 'push', 'origin', 'HEAD:main'])
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Auth fake: no env until recovered; recovery offers `good` (or nothing). */
  function fakeAuth(canRecover: boolean): GitAuth & { recovered: number } {
    let pinned: GitEnv | undefined
    const auth = {
      recovered: 0,
      env: async () => pinned,
      recover: async (_remote: string, canReach: (e: GitEnv) => Promise<boolean>) => {
        auth.recovered++
        if (!canRecover) return undefined
        const env = { GH_TOKEN: 'good' }
        if (!(await canReach(env))) return undefined
        pinned = env
        return env
      },
    }
    return auth
  }

  it('clone + fetch succeed through the recovered account, recovering only once', async () => {
    const auth = fakeAuth(true)
    const dir = join(root, 'wc1')
    const git = await Git.clone(remote, dir, fakeGit, auth)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('a\n')
    await git.fetch()
    expect(auth.recovered).toBe(1) // the second command already ran as the pinned account
  })

  it('surfaces the original error when no account can reach the repo', async () => {
    const auth = fakeAuth(false)
    await expect(Git.clone(remote, join(root, 'wc2'), fakeGit, auth)).rejects.toThrow(
      /Repository not found/,
    )
    expect(auth.recovered).toBe(1)
  })

  it('network commands never prompt for credentials', async () => {
    const log = join(root, 'prompt.log')
    await writeFile(log, '')
    await Git.clone(remote, join(root, 'wc3'), fakeGit, fakeAuth(true))
    const lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((l) => l === '0')).toBe(true)
  })
})
