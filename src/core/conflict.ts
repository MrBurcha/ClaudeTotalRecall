import type { Git } from './git'

/** "local" = tu versión (ours/HEAD); "remote" = la que viene del repo (theirs/MERGE_HEAD). */
export type ConflictSide = 'local' | 'remote'

/**
 * Resuelve UN archivo en conflicto quedándose con un lado y lo stagea.
 * Bajo merge, ours = local y theirs = remoto (mapeo intuitivo para la UI).
 */
export async function resolveConflictFile(
  git: Git,
  file: string,
  side: ConflictSide,
): Promise<void> {
  if (side === 'local') {
    await git.checkoutOurs(file)
  } else {
    await git.checkoutTheirs(file)
  }
}

/** Cierra el merge una vez resueltos todos los conflictos. */
export async function completeMerge(git: Git, message?: string): Promise<void> {
  await git.completeMerge(message)
}
