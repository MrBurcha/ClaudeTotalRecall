import { open } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

/** Max bytes read into the renderer for a preview; larger files are truncated. */
export const MAX_PREVIEW_BYTES = 1_048_576 // 1 MiB

export interface MemoryFilePreview {
  content: string
  /** full byte size on disk (even when truncated) */
  size: number
  truncated: boolean
  binary: boolean
  exists: boolean
}

/**
 * Reads a memories file from the repo working copy for preview. Defends against:
 * path traversal (the resolved path must stay inside `<repoRoot>/memories`),
 * oversized files (reads only the first {@link MAX_PREVIEW_BYTES} via a positional
 * handle and flags `truncated`), and binary blobs (a NUL byte in the sample →
 * `binary`, no content). A missing file (e.g. a deletion) → `exists:false`.
 *
 * `repoRelPath` is a memories-relative path as it appears in a `FileChange` (it
 * carries the leading `memories/` segment). Content is never read from the real
 * machine source — only from the synced working copy — so secrets that never
 * travel can't be surfaced here.
 */
export async function readMemoryFilePreview(
  repoRoot: string,
  repoRelPath: string,
): Promise<MemoryFilePreview> {
  const missing: MemoryFilePreview = {
    content: '',
    size: 0,
    truncated: false,
    binary: false,
    exists: false,
  }

  const full = resolve(repoRoot, repoRelPath)
  const memoriesRoot = resolve(repoRoot, 'memories')
  if (full !== memoriesRoot && !full.startsWith(memoriesRoot + sep)) return missing

  let handle
  try {
    handle = await open(full, 'r')
  } catch {
    return missing
  }
  try {
    const st = await handle.stat()
    if (!st.isFile()) return missing
    const size = st.size
    const cap = Math.min(size, MAX_PREVIEW_BYTES)
    const buf = Buffer.alloc(cap)
    if (cap > 0) await handle.read(buf, 0, cap, 0)
    const binary = buf.includes(0)
    return {
      content: binary ? '' : buf.toString('utf8'),
      size,
      truncated: size > MAX_PREVIEW_BYTES,
      binary,
      exists: true,
    }
  } finally {
    await handle.close()
  }
}
