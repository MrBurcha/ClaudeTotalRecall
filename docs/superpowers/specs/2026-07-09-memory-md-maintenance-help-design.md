# Design: MEMORY.md maintenance help (post-sync reconciliation)

- **Issue:** #73 — "Mergeo de MEMORY.md"
- **Date:** 2026-07-09
- **Status:** Approved design, pending implementation plan
- **Layers:** core (prompt constant + fs detection) → main (IPC) → renderer (reusable modal + 2 triggers) → README + i18n.

## Problem

`MEMORY.md` is the index of a Claude Code memory store. When two machines held
different memory files and then synced, the index can end up reflecting only the
machine that synced last — so it lists memories that aren't on disk, or misses
ones that are. The app has no special knowledge of `MEMORY.md` today, and nothing
tells the user that after such a sync they should reconcile the index.

The fix is **guidance, not automation**: surface a maintenance prompt (to run in
Claude Code) at the two moments the risk is real, plus document it in the README.

## Decisions (from the user)

1. **No tracking.** The app can't know whether the user actually ran the prompt (it
   happens externally in Claude Code). The help is advisory/on-demand; no persisted
   "last run" state.
2. **On save → auto-open the modal.** Configuring a project source on a second
   machine is rare, so an auto-popup lands exactly when it's useful.
3. **In Recent Activity → only on _received_ changes**, i.e. incoming (↙) or another
   machine's outgoing (↓) — never this machine's own push (↑).
4. **The copy must be crystal clear that a received `MEMORY.md` update usually needs
   NO action.** Once the user runs the pass on machine A, the fix propagates to B as
   a normal received update — expected, already reconciled, no counter-action. The
   modal must separate "when to run it" from "when to ignore it" so it doesn't push
   people to run it in a loop.
5. **The prompt is English-only, single source of truth.** A constant in `src/core`,
   shared by the modal and the README. The modal _chrome_ (explanation, buttons) is
   bilingual; the prompt itself is a technical artifact for Claude Code and is not
   translated.

## Detection (what "a MEMORY.md" means)

- A `MEMORY.md` is never a user-level item (`resolve.ts` `USER_LEVEL_SPEC` syncs only
  `CLAUDE.md`, `commands/`, `agents/`, `skills/`, `settings.json`). It only enters
  sync **inside a per-project source** (dir slot → `memories/projects/<name>/<slot>/…`),
  or as a single-file slot / pinned file.
- **In the activity feed:** a file change whose repo-relative path basename is
  `MEMORY.md`. New pure helper `isMemoryIndexPath(path)` (`memoryPath.ts`).
- **On a saved source:** new core fs helper `folderContainsMemoryIndex(adapter, path, kind)`:
  for `kind='file'`, basename is `MEMORY.md`; for `kind='dir'`, `<path>/MEMORY.md`
  exists as a file (top-level only — the index lives at the memory-store root).

## Architecture

### Core (`src/core/`)

- **`memoryMaintenance.ts` (new):**
  - `export const MEMORY_MAINTENANCE_PROMPT: string` — the verbatim prompt from the
    issue (English). Single source of truth for the modal and (mirrored, drift-tested)
    the README.
  - `export async function folderContainsMemoryIndex(adapter: PlatformAdapter, absolutePath: string, kind: 'file' | 'dir'): Promise<boolean>` — uses `node:fs/promises` (allowed: core is pure Node, no Electron). Returns `false` on any error (non-fatal).
- **`memoryPath.ts` (modify):** add `export function isMemoryIndexPath(path: string): boolean` → `path.split('/').pop() === 'MEMORY.md'`.

Both are unit-tested (core coverage gate). The prompt↔README consistency is guarded
by a test that reads `README.md` and asserts it contains `MEMORY_MAINTENANCE_PROMPT`.

### Main / IPC (`src/main/`)

- **`ipc.ts`:** `handle('clipboard:writeText', (_e, text: string) => { clipboard.writeText(text) })` (import `clipboard` from electron); `handle('project:folderHasMemoryIndex', (_e, p: { path: string; kind: 'file' | 'dir' }) => folderContainsMemoryIndex(adapter(), p.path, p.kind))`.
- **`preload.ts`:** add to the `api` object (auto-typed via `ClaudeTotalRecallApi = typeof api`):
  - `clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>`
  - `projectFolderHasMemoryIndex: (path: string, kind: 'file' | 'dir') => ipcRenderer.invoke('project:folderHasMemoryIndex', { path, kind }) as Promise<boolean>`

There is **no clipboard usage anywhere in the repo today** — this adds the first, via
the Electron `clipboard` module (consistent with "OS things go through main").

### Renderer (`src/renderer/`)

- **Reusable modal** `features/memory/MemoryMaintenanceModal.tsx` (new): a `<Modal size="lg">`
  with the bilingual explanation (intro / when-to-run / when-to-ignore / paste), the
  prompt in a scrollable `<pre>` block, and a **Copy prompt** button that calls
  `api.clipboardWrite(MEMORY_MAINTENANCE_PROMPT)` and flips its label to "Copied".
  Registered as modal kind `'memory-maintenance'` (add to `ModalDescriptor` union in
  `state/types.ts` + a `case` in `ModalHost.tsx`). No data props — reused verbatim by
  both triggers.
- **Trigger A — `features/sync/RecentActivity.tsx`:** per activity entry compute
  `received = e.type === 'incoming' || (e.type === 'outgoing' && e.machineId !== machineId)`.
  In each file row, when `received && isMemoryIndexPath(f.path)`, render an `info`
  `IconButton` (label `activity.memoryHelp`) that opens the `memory-maintenance` modal.
- **Trigger B — auto-open on second-machine save** (both write paths):
  - `features/projects/FolderEditor.tsx`: after a successful `api.projectSetFolder`,
    if the project is already on another machine
    (`otherMachineHasProject`, computed from `config.projects[project].folders` for any
    machineId `!== machineId`) **and** `await api.projectFolderHasMemoryIndex(path, kind)`,
    open the modal (after `onDone()`).
  - `features/projects/ProjectAdoptModal.tsx`: after a successful `api.projectApplyMapping`,
    adoption inherently means the project is on another machine, so if any adopted
    slot's path `projectFolderHasMemoryIndex`, open the modal (after `closeModal()`).

### README (`README.md`, English-only)

New `## Keeping MEMORY.md in sync` section after **How it works** (`:150`), before
**What gets synced** (`:163`): explains the stale-index risk, when to run / ignore the
pass, and includes the prompt verbatim (must equal `MEMORY_MAINTENANCE_PROMPT`).

## Copy (English source; es mirrors under the same keys)

Modal, keys under `memoryHelp.*`:

| key               | English                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | Reconcile your MEMORY.md index                                                                                                                                                                                                                                 |
| `intro`           | MEMORY.md is the index of a memory store. When two machines held different memories and then synced, the index can end up reflecting only the machine that synced last — listing memories that aren't on disk, or missing ones that are.                       |
| `whenRunTitle`    | When to run it                                                                                                                                                                                                                                                 |
| `whenRun`         | If your machines had genuinely different memory content that just merged, run the maintenance pass below in Claude Code, in the affected project, to reconcile the index with the files on disk.                                                               |
| `whenIgnoreTitle` | When you can ignore it                                                                                                                                                                                                                                         |
| `whenIgnore`      | If this update is just a reconciliation you already ran on another machine propagating here, it's already consistent — you don't need to run anything. This notice appears whenever a MEMORY.md arrives from another machine, not only when something's wrong. |
| `paste`           | Paste this prompt into Claude Code, in the affected project:                                                                                                                                                                                                   |
| `copy`            | Copy prompt                                                                                                                                                                                                                                                    |
| `copied`          | Copied                                                                                                                                                                                                                                                         |

Activity affordance, key `activity.memoryHelp`: "About this MEMORY.md update".

Spanish (es-419), same keys — notably `whenIgnore`: "Si esta actualización es solo la
reconciliación que ya corriste en otra máquina propagándose acá, ya quedó consistente
— no necesitás correr nada. Este aviso aparece cada vez que llega un MEMORY.md desde
otra máquina, no solo cuando algo está mal."

## The prompt (verbatim, `MEMORY_MAINTENANCE_PROMPT`)

```
Do a maintenance pass on your memory store.
1. Reindex. Reconcile the MEMORY.md index against the memory files actually on disk: add any memory that exists but isn't indexed, remove index lines whose file is gone, and fix hooks that no longer match their file's content. Keep each hook faithful to what the memory actually says.
2. Find contradictions. Look for two kinds: memories that conflict with each other, and memories that conflict with current reality. For the second kind, verify claims against the actual repo/code/git before trusting them — a memory can have been correct when written but gone stale since. List everything you find and check with me before editing or deleting anything.
3. Reorganize if warranted. Merge duplicates, split overloaded memories, and fix miscategorized ones — but preserve the intentional split between "what this is / what happened" (project) memories and "how you should act" (feedback) memories; don't collapse those into each other. Ask before any destructive change.
4. Report a short summary of what you reindexed, which contradictions you found and how they were resolved, and what (if anything) you reorganized.
```

## Non-goals / scope

- No persisted "last run" / snooze / dismissal state (decision 1).
- No auto-running the pass, no auto-editing MEMORY.md — the app only surfaces guidance.
- The prompt is not translated (decision 5).
- No detection of _whether_ a received MEMORY.md is a genuine bad merge vs a clean
  propagation — that isn't reliably detectable, so the copy covers both cases instead.
- Untouched: `ProjectNewChooser`, discovery flow (out of the two named triggers).

## Files touched

- `src/core/memoryMaintenance.ts` (new), `src/core/memoryPath.ts` (modify)
- `src/core/memoryMaintenance.test.ts` (new), `src/core/memoryPath.test.ts` (new or modify)
- `src/main/ipc.ts`, `src/main/preload.ts`
- `src/renderer/state/types.ts`, `src/renderer/screens/ModalHost.tsx`
- `src/renderer/features/memory/MemoryMaintenanceModal.tsx` (new)
- `src/renderer/features/sync/RecentActivity.tsx`
- `src/renderer/features/projects/FolderEditor.tsx`, `src/renderer/features/projects/ProjectAdoptModal.tsx`
- `src/renderer/theme/components.css` (a `.memory-prompt` block style)
- `src/renderer/i18n/en.json`, `src/renderer/i18n/es.json`
- `README.md`

## Testing & verification

- **Core unit tests** (coverage gate): `folderContainsMemoryIndex` (dir with/without
  `MEMORY.md`; file that is/isn't `MEMORY.md`), `isMemoryIndexPath`, and the
  README↔constant drift test.
- **i18n** parity/keysExist cover the new keys automatically.
- **Static gates:** typecheck, lint (`--max-warnings 0`), prettier.
- **Visual verification:** launch the Electron app against an isolated HOME; (a) seed
  activity with a received MEMORY.md change and confirm the help icon → modal with a
  working Copy button; (b) confirm the modal auto-opens when saving/adopting a source
  containing a `MEMORY.md` on a project already configured on another machine.
