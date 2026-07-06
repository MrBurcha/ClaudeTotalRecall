import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Dirs comunes donde suelen vivir los binarios en macOS/Linux. */
function commonDirs(): string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.local', 'bin'),
  ]
}

/**
 * Devuelve un PATH aumentado (string con separador ':') combinando el PATH actual + dirs comunes,
 * deduplicando y preservando orden (primero lo existente, luego los comunes que falten).
 */
export function resolveEnvPath(currentPath?: string): string {
  const current = currentPath ?? process.env.PATH ?? ''
  const seen = new Set<string>()
  const result: string[] = []

  const add = (dir: string): void => {
    if (dir === '' || seen.has(dir)) return
    seen.add(dir)
    result.push(dir)
  }

  for (const dir of current.split(':')) add(dir)
  for (const dir of commonDirs()) add(dir)

  return result.join(':')
}

/** Verifica que la ruta apunte a un archivo ejecutable. */
function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Busca un ejecutable por nombre en las dirs del PATH dado (o resolveEnvPath()). Devuelve ruta
 * absoluta o null.
 */
export function findExecutable(name: string, envPath?: string): string | null {
  const searchPath = envPath ?? resolveEnvPath()

  for (const dir of searchPath.split(':')) {
    if (dir === '') continue
    const candidate = path.join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }

  return null
}
