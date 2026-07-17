/**
 * Inverse of the `memories/…` logical-path builders in resolve.ts
 * (`projectSlotLogicalPath`, `userLevelItems`, `pinnedFileItems`): given a
 * repo-relative path from git or a Plan action, classify it into the app-facing
 * bucket the user understands (a project, user-level, a pinned file) so the
 * activity view can group and label it in their vocabulary instead of leaking
 * the raw repo layout.
 *
 * Pure string logic on purpose — NO `node:*` imports — so the renderer bundle
 * can import it directly (resolve.ts can't: it pulls `node:path`).
 */
export type MemoryLocation =
  | { bucket: 'project'; project: string; slot: string; rest: string }
  | { bucket: 'user'; slot: string; rest: string }
  | { bucket: 'pinned'; pin: string }
  | { bucket: 'notebook'; scope: 'general' | 'project'; project?: string; rest: string }
  | { bucket: 'unknown'; path: string }

/**
 * Parses a repo-relative memories path (with or without the leading `memories/`
 * prefix; backslashes tolerated) into a {@link MemoryLocation}. Anything that
 * doesn't match a known bucket — `claudetr.json`, `.gitignore`, a path missing
 * its slot segment, the empty string — falls through to `unknown` carrying the
 * original path.
 */
export function parseMemoryPath(repoRelPath: string): MemoryLocation {
  const unknown: MemoryLocation = { bucket: 'unknown', path: repoRelPath }
  const segs = repoRelPath
    .replace(/\\/g, '/')
    .replace(/^memories\//, '')
    .split('/')
    .filter(Boolean)
  if (segs.length === 0) return unknown

  switch (segs[0]) {
    case 'projects':
      // projects/<project>/<slot>[/rest…]
      if (segs.length < 3) return unknown
      return { bucket: 'project', project: segs[1], slot: segs[2], rest: segs.slice(3).join('/') }
    case 'user':
      // user/<slot>[/rest…]
      if (segs.length < 2) return unknown
      return { bucket: 'user', slot: segs[1], rest: segs.slice(2).join('/') }
    case 'pinned':
      // pinned/<pin…>
      if (segs.length < 2) return unknown
      return { bucket: 'pinned', pin: segs.slice(1).join('/') }
    case 'notebook':
      // notebook/general[/rest…] or notebook/projects/<project>[/rest…] (#104)
      if (segs[1] === 'projects') {
        if (segs.length < 3) return unknown
        return {
          bucket: 'notebook',
          scope: 'project',
          project: segs[2],
          rest: segs.slice(3).join('/'),
        }
      }
      if (segs[1] === 'general') {
        return { bucket: 'notebook', scope: 'general', rest: segs.slice(2).join('/') }
      }
      return unknown
    default:
      return unknown
  }
}

/**
 * True for repo-structure placeholders that aren't real memory content — the
 * `.gitkeep` files that seed the empty `memories/**` dirs. The activity feed
 * hides them so the first sync doesn't read as "removed a bunch of files".
 */
export function isStructuralNoise(repoRelPath: string): boolean {
  const path = repoRelPath.replace(/\\/g, '/')
  return path === '.gitkeep' || path.endsWith('/.gitkeep')
}

/**
 * True when a repo-relative path's basename is the memory index file `MEMORY.md`.
 * Drives the "reconcile your index" help affordance in the activity feed (#73).
 */
export function isMemoryIndexPath(repoRelPath: string): boolean {
  return repoRelPath.replace(/\\/g, '/').split('/').pop() === 'MEMORY.md'
}
