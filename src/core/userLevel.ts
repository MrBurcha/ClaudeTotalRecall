/**
 * The fixed user-level slots: items under `~/.claude` that sync on every machine,
 * mapped to `memories/user/<slot>` (see `userLevelItems` in resolve.ts).
 *
 * Pure data on purpose — NO `node:*` imports — so the renderer bundle can import
 * it too (the Projects overview lists these entries); resolve.ts can't be imported
 * there because it pulls `node:path`.
 */
export const USER_LEVEL_SPEC: ReadonlyArray<{ slot: string; kind: 'file' | 'dir' }> = [
  { slot: 'CLAUDE.md', kind: 'file' },
  { slot: 'commands', kind: 'dir' },
  { slot: 'agents', kind: 'dir' },
  { slot: 'skills', kind: 'dir' },
  { slot: 'settings.json', kind: 'file' },
]

/** Repo logical path of a user-level slot. */
export function userLevelLogicalPath(slot: string): string {
  return `memories/user/${slot}`
}
