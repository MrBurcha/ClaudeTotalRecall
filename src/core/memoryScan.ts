import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PlatformAdapter } from '../platform'

/**
 * Does this just-saved project source contain the memory index? For a single-file
 * slot, the file itself is MEMORY.md; for a mirrored dir, MEMORY.md sits at its root
 * (the memory store root). Best-effort — any fs error resolves to false.
 *
 * Uses `node:*`, so it's main-only — the renderer reaches it over IPC. The pure
 * prompt constant lives in `memoryMaintenance.ts` so the renderer can import that.
 */
export async function folderContainsMemoryIndex(
  adapter: PlatformAdapter,
  absolutePath: string,
  kind: 'file' | 'dir',
): Promise<boolean> {
  const path = adapter.expandHome(absolutePath.trim())
  if (!path) return false
  if (kind === 'file') return basename(path) === 'MEMORY.md'
  try {
    return (await stat(join(path, 'MEMORY.md'))).isFile()
  } catch {
    return false
  }
}
