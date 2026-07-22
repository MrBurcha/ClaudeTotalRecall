import { spawn } from 'node:child_process'
import { findExecutable, resolveEnvPath } from './resolvePath'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  cwd?: string
  /** vars extra; se mergean sobre process.env. El PATH siempre se resuelve. */
  env?: NodeJS.ProcessEnv
  /** input a stdin */
  input?: string
}

/**
 * Ejecuta un binario resolviendo un PATH usable (crítico para la app empaquetada:
 * launchd/Finder no heredan el PATH del shell, así que git/gh en /opt/homebrew/bin
 * no se encuentran). Nunca usa shell. No tira por exit code != 0; devuelve el code.
 */
export function run(bin: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const envPath = resolveEnvPath(opts.env?.PATH ?? process.env.PATH)
  const resolved = findExecutable(bin, envPath) ?? bin
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env, PATH: envPath }

  // On Windows, spawn() without a shell cannot launch a .cmd/.bat wrapper.
  // findExecutable resolves git/gh to their .exe (PATHEXT puts .EXE before .CMD),
  // so this only kicks in for a batch shim; the common .exe path keeps shell:false
  // and its exact-quoting guarantee.
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)

  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, { cwd: opts.cwd, env, shell: needsShell })
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
