import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { findExecutable, resolveEnvPath } from './resolvePath'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
  /** Extra vars, merged over process.env. PATH is always resolved. */
  env?: NodeJS.ProcessEnv
  /** Input written to stdin. */
  input?: string
}

/** The binaries that must run natively when this process runs under Rosetta (#133). */
const NATIVE_UNDER_ROSETTA = new Set(['git', 'gh'])

/** macOS' arch(1), always at this path; never resolved through PATH. */
const ARCH_BIN = '/usr/bin/arch'

export interface SpawnFacts {
  platform: NodeJS.Platform
  /** This process is an x86_64 binary translated by Rosetta on Apple Silicon. */
  translated: boolean
}

/**
 * Decides what to actually spawn for a resolved binary (#133). A process running
 * under Rosetta makes its children prefer the x86_64 slice of a universal binary,
 * so `/usr/bin/git` (the xcrun shim) starts as x86_64 and then fails to load an
 * arm64-only `libxcrun.dylib` (Command Line Tools 27). For git/gh only, we launch
 * through `arch -arm64 -x86_64`: arch tries the listed slices in order, so the
 * native arm64 slice wins and an x86_64-only binary (e.g. Intel Homebrew in
 * /usr/local/bin) still starts instead of failing with "Bad CPU type".
 */
export function spawnTarget(
  resolved: string,
  args: string[],
  facts: SpawnFacts,
): { command: string; args: string[] } {
  if (
    facts.platform === 'darwin' &&
    facts.translated &&
    NATIVE_UNDER_ROSETTA.has(path.posix.basename(resolved))
  ) {
    return { command: ARCH_BIN, args: ['-arm64', '-x86_64', resolved, ...args] }
  }
  return { command: resolved, args }
}

/** Reads `sysctl.proc_translated`: "1" under Rosetta, "0" native; missing on Intel Macs. */
export type SysctlReader = () => Promise<string>

const readProcTranslated: SysctlReader = () =>
  new Promise((resolve, reject) => {
    execFile('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    )
  })

/**
 * True if this process runs translated by Rosetta. darwin only; any failure (an
 * Intel Mac has no `sysctl.proc_translated`) counts as not translated.
 */
export async function detectTranslated(
  platform: NodeJS.Platform = process.platform,
  read: SysctlReader = readProcTranslated,
): Promise<boolean> {
  if (platform !== 'darwin') return false
  try {
    return (await read()).trim() === '1'
  } catch {
    return false
  }
}

// Cached as a promise so concurrent first calls share one sysctl spawn. A process
// never changes translation state, so the answer is valid for its whole lifetime.
let translatedOnce: Promise<boolean> | null = null
function isTranslated(): Promise<boolean> {
  translatedOnce ??= detectTranslated()
  return translatedOnce
}

/**
 * Runs a binary with a usable PATH (critical for the packaged app: launchd/Finder
 * don't inherit the shell's PATH, so git/gh in /opt/homebrew/bin wouldn't be
 * found). Never uses a shell, except for a Windows .cmd/.bat shim. Doesn't throw on
 * a non-zero exit code; returns it. Rejects only when the binary can't be spawned.
 */
export async function run(
  bin: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const envPath = resolveEnvPath(opts.env?.PATH ?? process.env.PATH)
  const resolved = findExecutable(bin, envPath) ?? bin
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env, PATH: envPath }
  const platform = process.platform
  const translated = platform === 'darwin' ? await isTranslated() : false
  const target = spawnTarget(resolved, args, { platform, translated })

  // On Windows, spawn() without a shell cannot launch a .cmd/.bat wrapper.
  // findExecutable resolves git/gh to their .exe (PATHEXT puts .EXE before .CMD),
  // so this only kicks in for a batch shim; the common .exe path keeps shell:false
  // and its exact-quoting guarantee.
  const needsShell = platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)

  return new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, { cwd: opts.cwd, env, shell: needsShell })
    // Collect raw Buffers and decode once: decoding per-chunk (`String(d)`) splits
    // a multi-byte UTF-8 char that straddles a chunk boundary into replacement
    // chars, which corrupts non-ASCII paths/content (e.g. a filename with ñ).
    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => outChunks.push(d))
    child.stderr.on('data', (d: Buffer) => errChunks.push(d))
    child.on('error', reject)
    child.on('close', (code) =>
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      }),
    )
    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }
  })
}
