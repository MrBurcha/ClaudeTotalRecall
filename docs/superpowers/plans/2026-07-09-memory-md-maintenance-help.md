# MEMORY.md maintenance help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a "reconcile your MEMORY.md index" maintenance prompt (to run in Claude Code) at the two moments the risk is real — when a MEMORY.md arrives from another machine (Recent Activity) and when saving a project source that contains a MEMORY.md on a second machine — plus document it in the README.

**Architecture:** A single English prompt constant in `src/core` is the source of truth for both a reusable renderer modal and the README (drift-tested). Detection is a pure path helper (`isMemoryIndexPath`) for the activity feed and a small fs helper (`folderContainsMemoryIndex`) exposed over a new IPC for the save triggers. Copy-to-clipboard is added (first use in the repo) via the Electron `clipboard` module. No persisted state — everything derives from existing data plus one fs check.

**Tech Stack:** TypeScript, Electron (main/preload IPC), React + react-i18next renderer, plain CSS tokens, vitest (node env, core-only tests).

Spec: `docs/superpowers/specs/2026-07-09-memory-md-maintenance-help-design.md`

## Global Constraints

- **Layering:** `src/core/` has no Electron imports (pure Node; `node:fs`/`node:path` OK). Renderer talks to main only through the preload bridge.
- **i18n:** every user-facing string lives in `src/renderer/i18n/en.json` + `es.json`, both in parity (`i18n/parity.test.ts`); every static `t()` key must exist (`i18n/keysExist.test.ts`). The **prompt itself is NOT a translated string** — it's a core constant, identical everywhere.
- **Style:** no semicolons, single quotes, 2-space indent (prettier). Comments/docs/commits in English.
- **Icon:** the help affordance uses the existing `info` icon (confirmed in `Icon.tsx`).
- **Quality gates before each commit:** `npm run typecheck`, `npm run lint` (`--max-warnings 0`), prettier. Core changes need unit tests (coverage gate). `npm test` runs the vitest suite (core + i18n).
- **No `.tsx` render tests exist** (vitest includes only `src/**/*.test.ts`, node env). Renderer behavior is verified by static gates + a final manual visual check; do not scaffold a render-test harness.

---

### Task 1: Prompt constant + README section (single source of truth)

Creates the English prompt constant and mirrors it into the README, guarded by a drift test so the two can't diverge.

**Files:**

- Create: `src/core/memoryMaintenance.ts`
- Create: `src/core/memoryMaintenance.test.ts`
- Modify: `README.md` (new section after `## How it works`, before `## What gets synced`)

**Interfaces:**

- Produces: `MEMORY_MAINTENANCE_PROMPT: string` (imported by the modal in Task 5 and the drift test here).

- [ ] **Step 1: Create the constant**

Create `src/core/memoryMaintenance.ts`:

```ts
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
```

- [ ] **Step 2: Add the README section**

In `README.md`, immediately before the `## What gets synced (and what to back up)` heading (currently line 163), insert:

````markdown
## Keeping MEMORY.md in sync

`MEMORY.md` is the index of a memory store. When two machines held different
memories and then synced, the index can end up reflecting only the machine that
synced last — listing memories that aren't on disk, or missing ones that are.

If that happens, open Claude Code in the affected project and run this maintenance
pass to reconcile the index with the files on disk:

```
Do a maintenance pass on your memory store.
1. Reindex. Reconcile the MEMORY.md index against the memory files actually on disk: add any memory that exists but isn't indexed, remove index lines whose file is gone, and fix hooks that no longer match their file's content. Keep each hook faithful to what the memory actually says.
2. Find contradictions. Look for two kinds: memories that conflict with each other, and memories that conflict with current reality. For the second kind, verify claims against the actual repo/code/git before trusting them — a memory can have been correct when written but gone stale since. List everything you find and check with me before editing or deleting anything.
3. Reorganize if warranted. Merge duplicates, split overloaded memories, and fix miscategorized ones — but preserve the intentional split between "what this is / what happened" (project) memories and "how you should act" (feedback) memories; don't collapse those into each other. Ask before any destructive change.
4. Report a short summary of what you reindexed, which contradictions you found and how they were resolved, and what (if anything) you reorganized.
```

You only need this when machines genuinely diverged. If a `MEMORY.md` update is just
a reconciliation you already ran on another machine propagating over, it's already
consistent — no action needed. The app shows the same guidance in-app (next to a
received `MEMORY.md` in Recent activity, and when you add such a source on a second
machine).
````

- [ ] **Step 3: Write the drift test**

Create `src/core/memoryMaintenance.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MEMORY_MAINTENANCE_PROMPT } from './memoryMaintenance'

describe('MEMORY_MAINTENANCE_PROMPT', () => {
  it('is mirrored verbatim in the README (no drift)', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8')
    expect(readme).toContain(MEMORY_MAINTENANCE_PROMPT)
  })
})
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/core/memoryMaintenance.test.ts`
Expected: PASS (README contains the exact prompt).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/core/memoryMaintenance.ts src/core/memoryMaintenance.test.ts README.md
git commit -m "feat(memory): add MEMORY.md maintenance prompt constant + README section (#73)"
```

---

### Task 2: Detection helpers (`isMemoryIndexPath`, `folderContainsMemoryIndex`)

Adds the pure path check (for the activity feed) and the fs check (for the save triggers), test-first.

**Files:**

- Modify: `src/core/memoryPath.ts` (add `isMemoryIndexPath`)
- Modify: `src/core/memoryMaintenance.ts` (add `folderContainsMemoryIndex`)
- Modify: `src/core/memoryMaintenance.test.ts` (add fs cases)
- Create: `src/core/memoryPath.test.ts` (if it doesn't already exist; otherwise modify)

**Interfaces:**

- Produces: `isMemoryIndexPath(path: string): boolean` (used by Task 6); `folderContainsMemoryIndex(adapter: PlatformAdapter, absolutePath: string, kind: 'file' | 'dir'): Promise<boolean>` (used by Task 3's IPC).

- [ ] **Step 1: Write the failing tests**

Append to `src/core/memoryMaintenance.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { folderContainsMemoryIndex } from './memoryMaintenance'

const stubAdapter = {
  expandHome: (p: string) => p,
} as unknown as import('../platform').PlatformAdapter

describe('folderContainsMemoryIndex', () => {
  it('is true for a dir slot that has a top-level MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    writeFileSync(join(dir, 'MEMORY.md'), '# index\n')
    expect(await folderContainsMemoryIndex(stubAdapter, dir, 'dir')).toBe(true)
  })
  it('is false for a dir slot without MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    writeFileSync(join(dir, 'notes.md'), 'x')
    expect(await folderContainsMemoryIndex(stubAdapter, dir, 'dir')).toBe(false)
  })
  it('is true for a file slot pointing at a MEMORY.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctr-mem-'))
    const f = join(dir, 'MEMORY.md')
    writeFileSync(f, 'x')
    expect(await folderContainsMemoryIndex(stubAdapter, f, 'file')).toBe(true)
  })
  it('is false for a file slot pointing at something else', async () => {
    expect(await folderContainsMemoryIndex(stubAdapter, '/nope/CLAUDE.md', 'file')).toBe(false)
  })
})
```

Create `src/core/memoryPath.test.ts` (or add this `describe` if the file exists):

```ts
import { describe, expect, it } from 'vitest'
import { isMemoryIndexPath } from './memoryPath'

describe('isMemoryIndexPath', () => {
  it('matches a MEMORY.md leaf regardless of depth', () => {
    expect(isMemoryIndexPath('memories/projects/foo/memory/MEMORY.md')).toBe(true)
    expect(isMemoryIndexPath('MEMORY.md')).toBe(true)
  })
  it('does not match other files', () => {
    expect(isMemoryIndexPath('memories/projects/foo/memory/notes.md')).toBe(false)
    expect(isMemoryIndexPath('memories/user/CLAUDE.md')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/core/memoryMaintenance.test.ts src/core/memoryPath.test.ts`
Expected: FAIL (`isMemoryIndexPath`/`folderContainsMemoryIndex` are not exported).

- [ ] **Step 3: Implement `isMemoryIndexPath`**

Append to `src/core/memoryPath.ts`:

```ts
/** True when a repo-relative path's basename is the memory index file MEMORY.md. */
export function isMemoryIndexPath(path: string): boolean {
  return path.split('/').pop() === 'MEMORY.md'
}
```

- [ ] **Step 4: Implement `folderContainsMemoryIndex`**

Append to `src/core/memoryMaintenance.ts`:

```ts
import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { PlatformAdapter } from '../platform'

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
```

(Put the three `import` lines at the top of `memoryMaintenance.ts`, above the constant.)

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/core/memoryMaintenance.test.ts src/core/memoryPath.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add src/core/memoryPath.ts src/core/memoryMaintenance.ts src/core/memoryMaintenance.test.ts src/core/memoryPath.test.ts
git commit -m "feat(memory): detect MEMORY.md by path and in a saved source folder (#73)"
```

---

### Task 3: IPC + preload (clipboard + folder-has-memory)

Exposes the fs check and a clipboard writer to the renderer.

**Files:**

- Modify: `src/main/ipc.ts`
- Modify: `src/main/preload.ts`

**Interfaces:**

- Consumes: `folderContainsMemoryIndex` (Task 2).
- Produces: `api.clipboardWrite(text)` and `api.projectFolderHasMemoryIndex(path, kind)` (used by Tasks 5, 7).

- [ ] **Step 1: Import clipboard + the core helper in `ipc.ts`**

Change the electron import (line 3) to add `clipboard`:

```ts
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
```

Add below the existing core imports (after line 8 `import * as svc from '../core/service'`):

```ts
import { folderContainsMemoryIndex } from '../core/memoryMaintenance'
```

- [ ] **Step 2: Register the two handlers**

Inside `registerIpc`, after `handle('preflight:run', () => runPreflight())` (line 49), add:

```ts
handle('clipboard:writeText', (_e, text: string) => {
  clipboard.writeText(text)
})
handle('project:folderHasMemoryIndex', (_e, p: { path: string; kind: 'file' | 'dir' }) =>
  folderContainsMemoryIndex(adapter(), p.path, p.kind),
)
```

- [ ] **Step 3: Add the preload bridge methods**

In `src/main/preload.ts`, inside the `const api = { … }` object, after the `projectSetFolder` entry (line 63-64), add:

```ts
  clipboardWrite: (text: string) =>
    ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
  projectFolderHasMemoryIndex: (path: string, kind: 'file' | 'dir') =>
    ipcRenderer.invoke('project:folderHasMemoryIndex', { path, kind }) as Promise<boolean>,
```

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS (`ClaudeTotalRecallApi = typeof api` picks up the new methods automatically).

```bash
git add src/main/ipc.ts src/main/preload.ts
git commit -m "feat(ipc): clipboard writer + folder-has-MEMORY.md check (#73)"
```

---

### Task 4: i18n keys

Adds the modal chrome + the activity affordance label to both catalogs.

**Files:**

- Modify: `src/renderer/i18n/en.json`
- Modify: `src/renderer/i18n/es.json`

**Interfaces:**

- Produces: `memoryHelp.*` and `activity.memoryHelp` keys (used by Tasks 5, 6).

- [ ] **Step 1: Add `activity.memoryHelp` to both catalogs**

Inside the existing `"activity": { … }` object, add one key. English (`en.json`):

```json
    "memoryHelp": "About this MEMORY.md update",
```

Spanish (`es.json`):

```json
    "memoryHelp": "Sobre esta actualización de MEMORY.md",
```

- [ ] **Step 2: Add the `memoryHelp` block to both catalogs**

Add a new top-level object (place it immediately before the top-level `"fileTag": {` key). English (`en.json`):

```json
  "memoryHelp": {
    "title": "Reconcile your MEMORY.md index",
    "intro": "MEMORY.md is the index of a memory store. When two machines held different memories and then synced, the index can end up reflecting only the machine that synced last — listing memories that aren't on disk, or missing ones that are.",
    "whenRunTitle": "When to run it",
    "whenRun": "If your machines had genuinely different memory content that just merged, run the maintenance pass below in Claude Code, in the affected project, to reconcile the index with the files on disk.",
    "whenIgnoreTitle": "When you can ignore it",
    "whenIgnore": "If this update is just a reconciliation you already ran on another machine propagating here, it's already consistent — you don't need to run anything. This notice appears whenever a MEMORY.md arrives from another machine, not only when something's wrong.",
    "paste": "Paste this prompt into Claude Code, in the affected project:",
    "copy": "Copy prompt",
    "copied": "Copied"
  },
```

Spanish (`es.json`):

```json
  "memoryHelp": {
    "title": "Reconciliá tu índice MEMORY.md",
    "intro": "MEMORY.md es el índice de un almacén de memoria. Cuando dos máquinas tenían memorias distintas y sincronizaron, el índice puede quedar reflejando solo la máquina que sincronizó última — listando memorias que no están en disco, o dejando afuera algunas que sí.",
    "whenRunTitle": "Cuándo correrlo",
    "whenRun": "Si tus máquinas tenían contenido de memoria genuinamente distinto que recién se mezcló, corré el mantenimiento de abajo en Claude Code, en el proyecto afectado, para reconciliar el índice con los archivos en disco.",
    "whenIgnoreTitle": "Cuándo podés ignorarlo",
    "whenIgnore": "Si esta actualización es solo la reconciliación que ya corriste en otra máquina propagándose acá, ya quedó consistente — no necesitás correr nada. Este aviso aparece cada vez que llega un MEMORY.md desde otra máquina, no solo cuando algo está mal.",
    "paste": "Pegá este prompt en Claude Code, en el proyecto afectado:",
    "copy": "Copiar prompt",
    "copied": "Copiado"
  },
```

- [ ] **Step 3: Verify parity + typecheck**

Run: `npx vitest run src/renderer/i18n/parity.test.ts src/renderer/i18n/keysExist.test.ts && npm run typecheck`
Expected: PASS (both catalogs have identical key sets; JSON valid).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/en.json src/renderer/i18n/es.json
git commit -m "i18n(memory): MEMORY.md maintenance modal + activity affordance strings (#73)"
```

---

### Task 5: Reusable MemoryMaintenanceModal

The shared modal: explanation + prompt + copy button. Both triggers open it.

**Files:**

- Create: `src/renderer/features/memory/MemoryMaintenanceModal.tsx`
- Modify: `src/renderer/state/types.ts` (add modal kind)
- Modify: `src/renderer/screens/ModalHost.tsx` (add case)
- Modify: `src/renderer/theme/components.css` (`.memory-prompt` block)

**Interfaces:**

- Consumes: `MEMORY_MAINTENANCE_PROMPT` (Task 1), `api.clipboardWrite` (Task 3), `memoryHelp.*` (Task 4), `<Modal>`, `Button`.
- Produces: modal kind `'memory-maintenance'` (opened by Tasks 6, 7).

- [ ] **Step 1: Add the modal kind to the union**

In `src/renderer/state/types.ts`, add a member to the `ModalDescriptor` union (next to the other `{ kind: … }` members):

```ts
  | { kind: 'memory-maintenance' }
```

- [ ] **Step 2: Create the modal component**

Create `src/renderer/features/memory/MemoryMaintenanceModal.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_MAINTENANCE_PROMPT } from '../../../core/memoryMaintenance'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { api } from '../../state/api'
import { useActions } from '../../state/useActions'

/**
 * Reusable help modal for reconciling a MEMORY.md index after a cross-machine sync.
 * Opened both from Recent activity (a received MEMORY.md) and when saving a project
 * source that contains a MEMORY.md on a second machine. The copy deliberately splits
 * "when to run it" from "when you can ignore it" — a normal propagated update needs
 * no action.
 */
export function MemoryMaintenanceModal(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await api.clipboardWrite(MEMORY_MAINTENANCE_PROMPT)
      setCopied(true)
    } catch {
      /* clipboard denied — non-fatal, the prompt is still visible to select */
    }
  }

  return (
    <Modal
      title={t('memoryHelp.title')}
      onClose={actions.closeModal}
      size="lg"
      footer={
        <Button variant="ghost" onClick={actions.closeModal}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="stack">
        <p className="muted">{t('memoryHelp.intro')}</p>
        <div className="stack stack-1">
          <span className="label">{t('memoryHelp.whenRunTitle')}</span>
          <p className="muted">{t('memoryHelp.whenRun')}</p>
        </div>
        <div className="stack stack-1">
          <span className="label">{t('memoryHelp.whenIgnoreTitle')}</span>
          <p className="muted">{t('memoryHelp.whenIgnore')}</p>
        </div>
        <p className="muted">{t('memoryHelp.paste')}</p>
        <pre className="memory-prompt mono">{MEMORY_MAINTENANCE_PROMPT}</pre>
        <div className="row">
          <Button size="sm" icon="check" onClick={copy}>
            {t(copied ? 'memoryHelp.copied' : 'memoryHelp.copy')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Wire it into ModalHost**

In `src/renderer/screens/ModalHost.tsx`, add the import (with the other feature-modal imports):

```tsx
import { MemoryMaintenanceModal } from '../features/memory/MemoryMaintenanceModal'
```

And add a case in the `switch (top.kind)`:

```tsx
    case 'memory-maintenance':
      return <MemoryMaintenanceModal />
```

- [ ] **Step 4: Add the prompt-block style**

In `src/renderer/theme/components.css`, add:

```css
.memory-prompt {
  max-height: 320px;
  overflow: auto;
  padding: var(--space-3);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  white-space: pre-wrap;
  font-size: var(--text-sm);
}
```

- [ ] **Step 5: Typecheck + lint + keysExist**

Run: `npm run typecheck && npm run lint && npx vitest run src/renderer/i18n/keysExist.test.ts`
Expected: PASS (the `ModalDescriptor` switch stays exhaustive; all `memoryHelp.*` keys exist).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/features/memory/MemoryMaintenanceModal.tsx src/renderer/state/types.ts src/renderer/screens/ModalHost.tsx src/renderer/theme/components.css
git commit -m "feat(memory): reusable MEMORY.md maintenance modal with copy button (#73)"
```

---

### Task 6: Trigger A — help affordance in Recent activity

A subtle `info` button next to a MEMORY.md that arrived from another machine.

**Files:**

- Modify: `src/renderer/features/sync/RecentActivity.tsx`

**Interfaces:**

- Consumes: `isMemoryIndexPath` (Task 2), modal kind `'memory-maintenance'` (Task 5), `activity.memoryHelp` (Task 4).

- [ ] **Step 1: Add imports**

Add `IconButton` and `isMemoryIndexPath` to the existing imports at the top of `RecentActivity.tsx`:

```tsx
import { IconButton } from '../../components/IconButton'
import { isMemoryIndexPath, isStructuralNoise, parseMemoryPath } from '../../../core/memoryPath'
```

(The `memoryPath` import already exists for `isStructuralNoise, parseMemoryPath` — extend it with `isMemoryIndexPath` rather than adding a second import line.)

- [ ] **Step 2: Compute "received" per entry**

Inside the `entries.map((e) => { … })` body, next to the existing `const showFiles = …` (around line 262), add:

```tsx
// Only nudge about a MEMORY.md the user *received* (incoming, or another
// machine's push) — never their own push, which they just curated.
const received = e.type === 'incoming' || (e.type === 'outgoing' && e.machineId !== machineId)
```

- [ ] **Step 3: Render the help button next to a received MEMORY.md**

In the file row (the `g.files.map((f, i) => …)` `<li className="activity-file">`), after the file-link `<button>…{f.leaf}</button>`, add:

```tsx
{
  received && isMemoryIndexPath(f.path) && (
    <IconButton
      icon="info"
      label={t('activity.memoryHelp')}
      onClick={() => actions.openModal({ kind: 'memory-maintenance' })}
    />
  )
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/sync/RecentActivity.tsx
git commit -m "feat(activity): help affordance next to a received MEMORY.md (#73)"
```

---

### Task 7: Trigger B — auto-open on second-machine save (both write paths)

When saving/adopting a source that contains a MEMORY.md on a project already on another machine, auto-open the modal.

**Files:**

- Modify: `src/renderer/features/projects/FolderEditor.tsx`
- Modify: `src/renderer/features/projects/ProjectAdoptModal.tsx`

**Interfaces:**

- Consumes: `api.projectFolderHasMemoryIndex` (Task 3), modal kind `'memory-maintenance'` (Task 5).

- [ ] **Step 1: FolderEditor — read config/machine for the "other machine" check**

In `src/renderer/features/projects/FolderEditor.tsx`, add the store import and read config + machineId. Add the import:

```tsx
import { useAppState } from '../../state/store'
```

In the component body, next to `const actions = useActions()` (line 30), add:

```tsx
const { config, machineId } = useAppState()
```

- [ ] **Step 2: FolderEditor — open the modal after a qualifying save**

Replace the success block inside `submit()` (lines 93-97, the `try { await api.projectSetFolder… onDone() }`) with:

```tsx
try {
  await api.projectSetFolder(project, s, path.trim(), kind)
  actions.notify(t('projects.folderSaved', { slot: s, project }), 'ok')
  // If this project already lives on another machine and the source we just
  // saved carries a MEMORY.md, the index may now be out of sync — offer the pass.
  const otherMachineHasProject = Object.values(config?.projects[project]?.folders ?? {}).some(
    (byMachine) => Object.keys(byMachine).some((m) => m !== machineId),
  )
  const showMemoryHelp =
    otherMachineHasProject &&
    (await api.projectFolderHasMemoryIndex(path.trim(), kind).catch(() => false))
  await actions.refresh()
  onDone()
  if (showMemoryHelp) actions.openModal({ kind: 'memory-maintenance' })
} catch (e) {
  setError(normalizeError(e))
  setSubmitting(false)
}
```

- [ ] **Step 3: ProjectAdoptModal — open the modal after a qualifying adopt**

In `src/renderer/features/projects/ProjectAdoptModal.tsx`, replace the success block inside `submit()` (lines 143-149) with:

```tsx
const res = await api.projectApplyMapping({
  projectName: name,
  slots: chosen.map((r) => ({ slot: r.slot, path: r.path.trim(), kind: r.kind })),
})
// Adopting means the project is already on another machine; if any adopted
// source carries a MEMORY.md, the index may need reconciling — offer the pass.
const showMemoryHelp = (
  await Promise.all(
    chosen.map((r) => api.projectFolderHasMemoryIndex(r.path.trim(), r.kind).catch(() => false)),
  )
).some(Boolean)
await actions.refresh()
actions.notify(t('projects.adopt.done', { count: res.slots }), 'ok')
actions.closeModal()
if (showMemoryHelp) actions.openModal({ kind: 'memory-maintenance' })
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/projects/FolderEditor.tsx src/renderer/features/projects/ProjectAdoptModal.tsx
git commit -m "feat(projects): auto-open MEMORY.md help when saving such a source on a 2nd machine (#73)"
```

---

### Task 8: Full suite + visual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full quality suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (core unit tests + i18n parity/keysExist + drift test).

- [ ] **Step 2: Launch the app against an isolated HOME**

Build (`npx electron-vite build`) and boot the app with an isolated sandbox HOME (per the project's Electron verification approach). Seed:

- A project source folder that contains a `MEMORY.md`, mapped on a second (fake) machine, so it appears in Recent activity as a received change, and so adopting/saving it here qualifies.

- [ ] **Step 3: Confirm each acceptance criterion (screenshot + DOM)**

- Recent activity: a **received** MEMORY.md change (incoming ↙ or another machine ↓) shows the `info` help button; the user's own push (↑) does **not**. Clicking it opens the modal.
- The modal shows the intro + "When to run it" / "When you can ignore it" + the prompt block; **Copy prompt** copies the exact `MEMORY_MAINTENANCE_PROMPT` (verify via the sandbox clipboard or by pasting) and the label flips to "Copied".
- Saving a source containing a `MEMORY.md` on a project already on another machine (via FolderEditor and via the adopt modal) auto-opens the modal; saving one with no MEMORY.md, or on a single-machine project, does **not**.
- Toggle light theme: the prompt block and modal read correctly.

- [ ] **Step 4: (No code) record the verification result in the PR.**

---

## Self-Review

**Spec coverage:**

- Prompt constant, single source of truth + README → Task 1 (+ drift test). ✓
- Detection (`isMemoryIndexPath`, `folderContainsMemoryIndex`) → Task 2. ✓
- Clipboard + fs IPC → Task 3. ✓
- Bilingual chrome, English-only prompt → Task 4 (+ constant in Task 1). ✓
- Reusable modal (kind + host + component + CSS) → Task 5. ✓
- Trigger A, received-only, clear copy → Task 6 (+ copy in Task 4). ✓
- Trigger B, auto-open, both write paths → Task 7. ✓
- No tracking / no auto-edit → nothing persisted, as intended. ✓
- Verification (core tests + i18n + manual visual) → Task 8. ✓

**Placeholder scan:** every code step shows exact code; every command shows expected output. No TBD.

**Type consistency:** `folderContainsMemoryIndex(adapter, path, kind)` and `isMemoryIndexPath(path)` defined in Task 2 match the IPC in Task 3 and the calls in Tasks 6/7. `api.clipboardWrite` / `api.projectFolderHasMemoryIndex` defined in Task 3 match usage in Tasks 5/7. Modal kind `'memory-maintenance'` defined in Task 5 matches `openModal` calls in Tasks 6/7. `MEMORY_MAINTENANCE_PROMPT` defined in Task 1 used in Tasks 3(test)/5. ✓
