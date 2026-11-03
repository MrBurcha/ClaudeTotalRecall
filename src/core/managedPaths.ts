/**
 * Subtrees under `~/.claude` that Claude Code manages BY ITSELF and that must never
 * sync, in either direction (#135).
 *
 * `skills/synced/` holds Claude Code's own cache of the skills attached to the
 * claude.ai account: one `<org>_<account>/` bucket with a `manifest.json`, a
 * `.staging/` dir, a `.bucket-*` marker and a `.last-complete-round` file that is
 * rewritten on every refresh. Every machine downloads it from the account on its
 * own, so syncing it is redundant churn — and mirroring it (with deletes) races
 * Claude Code's refresh, which produced blocking modify/delete conflicts.
 *
 * Pure string logic on purpose — NO `node:*` imports — so the renderer bundle can
 * import it (the activity feed hides these paths too).
 */

/** Top-level entries of a user-level dir slot (keyed by slot) that never sync. */
export const USER_LEVEL_EXCLUDES: Readonly<Record<string, readonly string[]>> = {
  skills: ['synced'],
}

/** Repo-relative (posix) roots of the managed subtrees, e.g. `memories/user/skills/synced`. */
export function managedRepoPaths(): string[] {
  return Object.entries(USER_LEVEL_EXCLUDES).flatMap(([slot, entries]) =>
    entries.map((e) => `memories/user/${slot}/${e}`),
  )
}

/** True when a repo-relative path (posix or native separators) lies in a managed subtree. */
export function isManagedRepoPath(repoRelPath: string): boolean {
  const path = repoRelPath.replace(/\\/g, '/')
  return managedRepoPaths().some((root) => path === root || path.startsWith(`${root}/`))
}

/**
 * True when `rel` — a path relative to a slot's root, in posix or native form —
 * falls under one of the slot's excluded top-level entries. Only the FIRST segment
 * counts: `synced/x` is excluded, while a user skill's own `my-skill/synced/x` is not.
 */
export function isExcludedRel(rel: string, exclude: readonly string[]): boolean {
  if (exclude.length === 0) return false
  return exclude.includes(rel.split(/[\\/]/)[0])
}

/** `.gitignore` lines (anchored to the repo root) that keep the managed subtrees out of git. */
export function managedGitignoreLines(): string[] {
  return managedRepoPaths().map((p) => `/${p}/`)
}
