import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** PATH entry separator: ';' on Windows, ':' on POSIX. */
function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

/**
 * Executable extensions probed on Windows when a bare name (no extension) is
 * looked up, from PATHEXT (`.EXE` precedes `.CMD`, so `git`/`gh` resolve to their
 * .exe and never the .cmd shim). Empty on POSIX (names are used verbatim).
 */
function execExtensions(platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return ['']
  const pathext = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  // Lowercase the extensions so the resolved path is deterministic (`git.exe`,
  // not `git.EXE` from an uppercase PATHEXT). Windows' filesystem is
  // case-insensitive, so this still matches an on-disk `GIT.EXE`.
  return pathext
    .split(';')
    .filter((e) => e !== '')
    .map((e) => e.toLowerCase())
}

/** Dirs comunes donde suelen vivir los binarios, por SO. */
function commonDirs(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    // The Windows installers usually add these to PATH already, but the packaged
    // app benefits from the fallbacks (env vars may be unset when launched from
    // certain shells). %ProgramFiles%/%LOCALAPPDATA% are read via env.
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    return [
      path.join(programFiles, 'Git', 'cmd'),
      path.join(programFiles, 'Git', 'bin'),
      path.join(programFiles, 'GitHub CLI'),
      path.join(localAppData, 'Programs', 'Git', 'cmd'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      path.join(os.homedir(), 'scoop', 'shims'),
    ]
  }
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
 * Devuelve un PATH aumentado combinando el PATH actual + dirs comunes,
 * deduplicando y preservando orden (primero lo existente, luego los comunes que falten).
 * Usa el separador del SO (';' en Windows, ':' en POSIX).
 */
export function resolveEnvPath(
  currentPath?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const delimiter = pathDelimiter(platform)
  const current = currentPath ?? process.env.PATH ?? ''
  const seen = new Set<string>()
  const result: string[] = []

  const add = (dir: string): void => {
    if (dir === '' || seen.has(dir)) return
    seen.add(dir)
    result.push(dir)
  }

  for (const dir of current.split(delimiter)) add(dir)
  for (const dir of commonDirs(platform)) add(dir)

  return result.join(delimiter)
}

/**
 * Verifica que la ruta apunte a un archivo ejecutable. En POSIX exige el bit X_OK;
 * en Windows la "ejecutabilidad" la da la extensión (chequeada en findExecutable),
 * así que acá basta con que sea un archivo.
 */
function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    if (platform !== 'win32') fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Busca un ejecutable por nombre en las dirs del PATH dado (o resolveEnvPath()). En
 * Windows, si el nombre no trae extensión, prueba cada una de PATHEXT. Devuelve ruta
 * absoluta o null.
 */
export function findExecutable(
  name: string,
  envPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const delimiter = pathDelimiter(platform)
  const searchPath = envPath ?? resolveEnvPath(undefined, platform)
  // On Windows, only probe PATHEXT extensions when the name lacks one already.
  const hasExt = platform === 'win32' && path.extname(name) !== ''
  const candidates = hasExt ? [name] : execExtensions(platform).map((ext) => name + ext)

  for (const dir of searchPath.split(delimiter)) {
    if (dir === '') continue
    for (const candidate of candidates) {
      const full = path.join(dir, candidate)
      if (isExecutableFile(full, platform)) return full
    }
  }

  return null
}
