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

  return new Promise((resolve, reject) => {
    const child = spawn(resolved, args, { cwd: opts.cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (opts.input !== undefined) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }
  })
}
