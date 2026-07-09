# "Project configured on another machine" notice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Projects screen clearly show _which_ project needs configuring on this machine, using a persistent accent (blue) treatment across three surfaces (banner, project row, source row) plus click-to-focus navigation.

**Architecture:** Renderer-only change. Reuses the existing detection (`unassociatedProjects`, `needsAdoption`, `byMachine[machineId] == null`). Adds a persistent `.card--accent` class, an accent "Configure here" badge on the collapsed project row, an accent missing-path treatment on source rows, and an additive focus signal (`{name, tick}`) that lets a banner name-chip expand + scroll to a project without converting `ProjectItem`'s local `open` state into a controlled prop.

**Tech Stack:** React 18 + TypeScript (electron-vite renderer), react-i18next (en/es catalogs), plain CSS with design tokens (`tokens.css`), vitest (node env, no `.tsx` render tests).

Spec: `docs/superpowers/specs/2026-07-09-project-on-other-machine-notice-design.md`

## Global Constraints

- **Renderer only.** No changes to `src/core`, `src/main`, IPC, or the data model. Detection functions are reused unchanged.
- **User-facing strings live in i18n only** — `src/renderer/i18n/en.json` + `es.json`. Never inline a literal string in TSX. Both catalogs must stay in parity (`i18n/parity.test.ts`) and every static `t()` key must exist in the catalog (`i18n/keysExist.test.ts`).
- **Code style:** no semicolons, single quotes, 2-space indent (prettier-enforced). Comments in English.
- **Visual language:** accent/blue family only (`--accent`, `--accent-weak`). Do NOT introduce amber/warn or danger tones for this feature. Alert icon name is `alert` (confirmed present in `Icon.tsx`).
- **Quality gates (all must pass before each commit):** `npm run typecheck`, `npm run lint` (runs with `--max-warnings 0`), and prettier formatting. i18n tests run as part of `npm test`.
- **No render tests exist** for the renderer (vitest includes only `src/**/*.test.ts` under the node env). UI behavior is verified by the i18n tests + static gates + a final manual visual check. Do not scaffold a new render-test harness for this change.

---

### Task 1: i18n keys (reword banner + add badge/focus strings)

Adds/rewords the strings the later tasks reference. Doing this first means `keysExist.test.ts` stays green as the TSX tasks land.

**Files:**

- Modify: `src/renderer/i18n/en.json` (projects block, ~lines 309-311)
- Modify: `src/renderer/i18n/es.json` (projects block, ~lines 309-311)

**Interfaces:**

- Consumes: nothing.
- Produces (keys other tasks call via `t()`):
  - `projects.unassociatedTitle_one` / `_other` (reworded, count param)
  - `projects.unassociatedHint` (reworded)
  - `projects.needsSetupBadge` (new)
  - `projects.focusProject` (new, `{{name}}` param)

- [ ] **Step 1: Reword the three existing keys in `en.json`**

Replace lines 309-311 (`projects.unassociatedTitle_one/_other`, `projects.unassociatedHint`) with:

```json
    "unassociatedTitle_one": "{{count}} project needs configuring on this machine",
    "unassociatedTitle_other": "{{count}} projects need configuring on this machine",
    "unassociatedHint": "Open one and use “Configure on this machine” to link its local folder — instead of creating a new one.",
    "needsSetupBadge": "Configure here",
    "focusProject": "Go to {{name}}",
```

(The last two lines are new keys inserted right after `unassociatedHint`.)

- [ ] **Step 2: Make the exact same structural change in `es.json`**

Replace lines 309-311 with:

```json
    "unassociatedTitle_one": "{{count}} proyecto necesita configurarse en esta máquina",
    "unassociatedTitle_other": "{{count}} proyectos necesitan configurarse en esta máquina",
    "unassociatedHint": "Abrí uno y usá «Configurar en esta máquina» para vincular su carpeta local — en lugar de crear uno nuevo.",
    "needsSetupBadge": "Configurar aquí",
    "focusProject": "Ir a {{name}}",
```

- [ ] **Step 3: Run the i18n tests to verify parity + key existence**

Run: `npx vitest run src/renderer/i18n/parity.test.ts src/renderer/i18n/keysExist.test.ts`
Expected: PASS (both catalogs have the same keys; the two new keys exist in both).

- [ ] **Step 4: Verify JSON is well-formed + typecheck**

Run: `npm run typecheck`
Expected: PASS (no TS errors; JSON imports resolve).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/i18n/en.json src/renderer/i18n/es.json
git commit -m "i18n(projects): reword unassociated notice + add needsSetupBadge/focusProject keys (#71)"
```

---

### Task 2: ProjectItem — accent badge on the collapsed row + focus receiver

Adds the "Configure here" badge to the collapsed head when the project needs
adoption, and wires the (additive) focus signal so a parent can expand + scroll
this row. The `focusTick` prop is optional, so the parent not passing it yet
(until Task 4) compiles cleanly.

**Files:**

- Modify: `src/renderer/features/projects/ProjectItem.tsx`

**Interfaces:**

- Consumes: `projects.needsSetupBadge` (Task 1); `Badge` from `../../components/Badge`; existing `needsAdoption` (line 34).
- Produces: `ProjectItem` now accepts an optional prop `focusTick?: number`. When it changes to a defined value, the row opens and scrolls into view. Task 4 supplies it.

- [ ] **Step 1: Update the React import to include `useEffect` and `useRef`**

Change line 1 from:

```tsx
import { useState } from 'react'
```

to:

```tsx
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 2: Add the `Badge` import**

Add below the existing `Icon` import (line 5):

```tsx
import { Badge } from '../../components/Badge'
```

- [ ] **Step 3: Add the `focusTick` prop to the signature**

Replace the params/type block (lines 20-28) with:

```tsx
export function ProjectItem({
  name,
  project,
  machineId,
  focusTick,
}: {
  name: string
  project: Project
  machineId: string | null
  focusTick?: number
}): JSX.Element {
```

- [ ] **Step 4: Add the root ref + focus effect after the local state**

Immediately after `const [adding, setAdding] = useState(false)` (line 41), add:

```tsx
const rootRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  if (focusTick === undefined) return
  setOpen(true)
  rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, [focusTick])
```

- [ ] **Step 5: Attach the ref to the root element**

Change line 87 from:

```tsx
    <div className="project-item">
```

to:

```tsx
    <div className="project-item" ref={rootRef}>
```

- [ ] **Step 6: Add the accent badge to the collapsed head**

In the head `<button>` (lines 93-95), insert the badge between the name span and
the source-count span:

```tsx
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="project-item__name grow">{name}</span>
        {needsAdoption && (
          <Badge>
            <Icon name="alert" size={12} />
            {t('projects.needsSetupBadge')}
          </Badge>
        )}
        <span className="muted">{t('projects.sourceCount', { count: folders.length })}</span>
```

- [ ] **Step 7: Typecheck + lint + keysExist**

Run: `npm run typecheck && npm run lint && npx vitest run src/renderer/i18n/keysExist.test.ts`
Expected: PASS. (In particular `react-hooks/exhaustive-deps` must not warn — `setOpen` and `rootRef` are stable, so `[focusTick]` is a complete dependency array; lint runs with `--max-warnings 0`.)

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/projects/ProjectItem.tsx
git commit -m "feat(projects): accent 'Configure here' badge + focus receiver on project row (#71)"
```

---

### Task 3: ProjectFolderRow — accent treatment for a source with no local path

Marks each source that has no path on this machine with an accent icon + label
instead of the current muted gray, so the sources to add stand out.

**Files:**

- Modify: `src/renderer/features/projects/ProjectFolderRow.tsx`
- Modify: `src/renderer/theme/screens.css` (near `.folder-row__main`, ~line 159)

**Interfaces:**

- Consumes: existing `current` (line 27), `projects.noPathOnMachine` (unchanged key), `Icon` (already imported).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the `.folder-row__missing` CSS class**

In `src/renderer/theme/screens.css`, immediately after the `.folder-row__main { … }`
rule (around line 159-163), add:

```css
.folder-row__missing {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent);
}
```

- [ ] **Step 2: Replace the muted "no path" span with the accent treatment**

In `ProjectFolderRow.tsx`, replace the `current ? … : …` block (lines 63-67) with:

```tsx
{
  current ? (
    <span className="mono grow truncate">{current}</span>
  ) : (
    <span className="folder-row__missing grow">
      <Icon name="alert" size={14} />
      {t('projects.noPathOnMachine')}
    </span>
  )
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/features/projects/ProjectFolderRow.tsx src/renderer/theme/screens.css
git commit -m "feat(projects): mark sources with no local path in accent (#71)"
```

---

### Task 4: Projects banner — persistent accent card, named chips, focus wiring

Rewrites the banner to be persistent (accent card + alert icon), lists the
affected projects as clickable chips, and passes the focus signal down to
`ProjectItem` (whose receiver landed in Task 2). This completes the end-to-end
navigation.

**Files:**

- Modify: `src/renderer/screens/Projects.tsx`
- Modify: `src/renderer/theme/components.css` (after `.card--danger`, ~line 433)

**Interfaces:**

- Consumes: `ProjectItem`'s optional `focusTick?: number` prop (Task 2); `unassociated: string[]` (existing, line 17); `projects.unassociatedTitle`, `projects.unassociatedHint`, `projects.focusProject` (Task 1); `Icon` (already imported).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the persistent accent card + link-accent CSS**

In `src/renderer/theme/components.css`, immediately after the `.card--danger { … }`
rule (ends ~line 433), add:

```css
.card--accent {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}
.link-accent {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
}
.link-accent:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Import `useState` in Projects.tsx**

Add as the first import line (above the react-i18next import on line 1):

```tsx
import { useState } from 'react'
```

- [ ] **Step 3: Add the focus state + handler inside the component**

After `const unassociated = config && machineId ? unassociatedProjects(config, machineId) : []`
(line 17), add:

```tsx
const [focus, setFocus] = useState<{ name: string; tick: number } | null>(null)
const focusProject = (name: string): void => setFocus((f) => ({ name, tick: (f?.tick ?? 0) + 1 }))
```

- [ ] **Step 4: Rewrite the banner block**

Replace the `unassociated.length > 0` block (lines 53-63) with:

```tsx
{
  unassociated.length > 0 && (
    <div className="card card--accent">
      <div className="card__head">
        <span className="card__title cluster">
          <Icon name="alert" size={16} />
          {t('projects.unassociatedTitle', { count: unassociated.length })}
        </span>
      </div>
      <p className="muted">{t('projects.unassociatedHint')}</p>
      <div className="cluster">
        {unassociated.map((name) => (
          <button
            key={name}
            type="button"
            className="link-accent"
            title={t('projects.focusProject', { name })}
            onClick={() => focusProject(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Pass `focusTick` to each `ProjectItem`**

Replace the map block (lines 67-69) with:

```tsx
{
  projects.map(([name, project]) => (
    <ProjectItem
      key={name}
      name={name}
      project={project}
      machineId={machineId}
      focusTick={focus?.name === name ? focus.tick : undefined}
    />
  ))
}
```

- [ ] **Step 6: Typecheck + lint + full i18n suite**

Run: `npm run typecheck && npm run lint && npx vitest run src/renderer/i18n`
Expected: PASS. (`focus?.name === name ? focus.tick : undefined` matches the `focusTick?: number` prop type; the `<button>` carries `type="button"` so no a11y/form lint fires.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/Projects.tsx src/renderer/theme/components.css
git commit -m "feat(projects): persistent accent notice with clickable project chips + focus nav (#71)"
```

---

### Task 5: Full suite + visual verification

Confirms nothing regressed and that the three surfaces + navigation actually
render as intended (there is no render test to catch this automatically).

**Files:** none (verification only).

- [ ] **Step 1: Run the full quality suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (i18n parity/keysExist included in `npm test`).

- [ ] **Step 2: Launch the app against an isolated HOME with a cross-machine config**

Using this repo's Electron verification approach (isolated `HOME`, per the
project's dogfooding/verify flow), seed a `claudetr.json` where two machines are
registered and a project (e.g. `acme-web`) has a slot mapped **only** on the other
machine's id — so `unassociatedProjects` returns it and, once expanded,
`ProjectFolderRow` shows a slot with no `byMachine[<thisMachineId>]`.

- [ ] **Step 3: Visually confirm each acceptance criterion on the Projects screen**

Take a screenshot and confirm:

- Banner uses a **persistent** accent tint (no fade) with the `alert` icon and the reworded title.
- The banner lists `acme-web` as a **clickable chip**; clicking it **expands and scrolls** to that project's row.
- The collapsed `acme-web` row shows the accent **"Configure here"** badge; a project fully configured here shows **no** badge.
- Inside `acme-web`, the unmapped slot shows the **accent** icon + "no path on this machine" label; a mapped slot shows its path in plain mono (unchanged).
- Toggle the app to light theme and confirm the accent tints still read correctly (tokens have light overrides).

- [ ] **Step 4: (No code) note the verification result**

Record the screenshot/outcome in the PR description. No commit for this task.

---

## Self-Review

**Spec coverage:**

- Banner persistent + alert icon + named clickable chips → Task 4 (+ Task 1 copy, + `.card--accent` CSS). ✓
- Project row accent badge (which project needs attention) → Task 2. ✓
- Source rows accent missing-path treatment → Task 3. ✓
- Navigation (chip → expand + scroll) → Task 2 (receiver) + Task 4 (emitter/wiring). ✓
- i18n both catalogs → Task 1. ✓
- CSS `.card--accent`, `.link-accent`, `.folder-row__missing` → Tasks 4, 4, 3 (folded into consumers). ✓
- Non-goals ("modify" detection, amber, other surfaces) → not implemented, as intended. ✓
- Verification (static gates + i18n tests + manual visual) → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact code; every command shows expected output. ✓

**Type consistency:** `focusTick?: number` defined in Task 2 is exactly what Task 4 passes (`focusTick={focus?.name === name ? focus.tick : undefined}`, value `number | undefined`). `focusProject(name: string)` defined and called in Task 4. `Badge` (default accent variant) used per its `components/Badge.tsx` signature. Icon name `alert` used consistently. ✓
