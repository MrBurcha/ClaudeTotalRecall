import { readFile, writeFile } from 'node:fs/promises'
import { ConfigSchema, type Config } from './types'

/** Valida `raw` contra ConfigSchema. Lanza ZodError si es inválido. */
export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}

/** Lee el JSON del archivo, lo parsea y lo valida. */
export async function loadConfig(filePath: string): Promise<Config> {
  const raw = await readFile(filePath, 'utf8')
  return parseConfig(JSON.parse(raw))
}

/** Valida y escribe el config como JSON pretty (2 espacios) con newline final. */
export async function saveConfig(filePath: string, config: Config): Promise<void> {
  const validated = parseConfig(config)
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
}
