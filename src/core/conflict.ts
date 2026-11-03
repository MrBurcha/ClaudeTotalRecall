import type { Git } from './git'

/** "local" = your version (ours/HEAD); "remote" = the one coming from the repo (theirs/MERGE_HEAD). */
export type ConflictSide = 'local' | 'remote'

/**
 * Resolves ONE conflicted file by keeping a side, and stages it. Under a merge,
 * ours = local and theirs = remote (the intuitive mapping for the UI).
 *
 * In a modify/delete conflict one side has no version of the file: keeping THAT
 * side means keeping the deletion, so the file is removed (`git rm`) instead of
 * checked out — `git checkout --ours|--theirs` would fail with "does not have our
 * version" and abort the whole merge finalization (#136).
 */
export async function resolveConflictFile(
  git: Git,
  file: string,
  side: ConflictSide,
): Promise<void> {
  const sides = await git.conflictSides(file)
  const kept = side === 'local' ? sides.ours : sides.theirs
  if (!kept) {
    await git.rm([file])
    return
  }
  if (side === 'local') {
    await git.checkoutOurs(file)
  } else {
    await git.checkoutTheirs(file)
  }
}

/** Completes the merge once every conflict is resolved. */
export async function completeMerge(git: Git, message?: string): Promise<void> {
  await git.completeMerge(message)
}
