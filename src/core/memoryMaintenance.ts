import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PlatformAdapter } from '../platform'

/**
 * The memory-store maintenance pass a user runs in Claude Code after two machines
 * with different memories sync — it reconciles MEMORY.md against the files on disk.
 * This is the single source of truth: the in-app help modal and the README both use
 * this exact text (a test asserts the README still contains it).
 */
export const MEMORY_MAINTENANCE_PROMPT = `Do a maintenance pass on your memory store.
1. Reindex. Reconcile the MEMORY.md index against the memory files actually on disk: add any memory that exists but isn't indexed, remove index lines whose file is gone, and fix hooks that no longer match their file's content. Keep each hook faithful to what the memory actually says.
2. Find contradictions. Look for two kinds: memories that conflict with each other, and memories that conflict with current reality. For the second kind, verify claims against the actual repo/code/git before trusting them — a memory can have been correct when written but gone stale since. List everything you find and check with me before editing or deleting anything.
3. Reorganize if warranted. Merge duplicates, split overloaded memories, and fix miscategorized ones — but preserve the intentional split between "what this is / what happened" (project) memories and "how you should act" (feedback) memories; don't collapse those into each other. Ask before any destructive change.
4. Report a short summary of what you reindexed, which contradictions you found and how they were resolved, and what (if anything) you reorganized.`

/**
 * Does this just-saved project source contain the memory index? For a single-file
 * slot, the file itself is MEMORY.md; for a mirrored dir, MEMORY.md sits at its root
 * (the memory store root). Best-effort — any fs error resolves to false.
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
