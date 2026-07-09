# Design: Reinforce the "project configured on another machine" notice

- **Issue:** #71 — "Mejora al feature de aviso de proyecto configurado en otra maquina"
- **Date:** 2026-07-09
- **Status:** Approved design, pending implementation plan
- **Layer:** Renderer only (React/TSX + CSS + i18n). No `core`, IPC, or data-model changes.

## Problem

On the Projects screen, when a project is configured on another machine but not
yet on this one, we show a banner. Today it:

1. Uses `.card--highlight`, a **one-shot 2.5s pulse** that fades to a plain card,
   so after a moment nothing signals that attention is needed.
2. Shows only a **generic count** ("1 project configured on another machine") and
   never names _which_ project needs attention — the core complaint in the issue.
3. Inside a project, the sources that lack a local path on this machine are shown
   with a plain muted gray label (`projects.noPathOnMachine`), with no visual cue
   that they are the thing to fix.

## Goals

Address the three asks in issue #71, in the **accent (blue)** visual language
chosen by the user (persistent, not a fading pulse; add an alert icon + badge):

1. **Banner** — persistent accent treatment + alert icon; **name** the affected
   project(s) as clickable chips.
2. **Project row** — the collapsed row of a project that needs attention carries
   the same accent treatment (an accent badge) so you can tell which one it is
   without expanding.
3. **Source rows** — each source with no local path on this machine is marked in
   accent (icon + colored label) instead of muted gray.
4. **Navigation** — clicking a project name in the banner expands and scrolls to
   that project in the list below.

## Non-goals / scope decisions

- **"Modify" is out of scope.** The issue mentions marking sources to
  "agregar / modificar". We can only _detect_ a source that has **no path on this
  machine** (the "add" case, via `byMachine[machineId] == null`). A path that
  exists but points somewhere wrong is not detectable, so only the missing-here
  case is flagged. Documented here rather than silently dropped.
- **Amber/warn semantics were considered and rejected** by the user in favor of
  staying in the accent (blue) family for visual cohesion with the app identity.
- **Other surfaces left untouched** (possible follow-up for consistency, not part
  of this change): `ProjectNewChooser.tsx` and `ProjectDiscoverModal.tsx` also use
  `.card--highlight` / similar hints.
- **No behavior change to sync, adoption, or config.** Detection only _invites_;
  it never blocks or auto-writes (consistent with the assisted, non-blocking
  reconciliation model).

## Detection (reused as-is, no changes)

All three signals already exist and are free:

- **Banner set** — `unassociatedProjects(config, machineId): string[]`
  (`src/core/nameMatch.ts:51`). A project where some slot is mapped on some
  machine but no slot is mapped for the current machine. Already called at
  `Projects.tsx:17`.
- **Project row** — `needsAdoption = !!machineId && folders.some(([, byMachine]) => !byMachine[machineId])`
  (`ProjectItem.tsx:34`). Fires when at least one slot lacks a path here. Already
  drives the "Configure on this machine" button.
- **Source row** — `current = byMachine[machineId]` (`ProjectFolderRow.tsx:27`).
  `!current` ⇒ this source has no local path here.

## Design

### A. Banner — `src/renderer/screens/Projects.tsx:53-63`

Replace the current block:

- Card class `card card--highlight` → `card card--accent` (**new persistent class**,
  see CSS below). Persistent accent tint, no fade.
- Icon `monitor` → `alert` (accent-colored; `alert` exists in `Icon.tsx`).
- Title (`projects.unassociatedTitle_one/_other`) reworded to action framing
  ("… needs configuring on this machine").
- Body: instead of the generic `projects.unassociatedHint` paragraph, render a
  short lead-in followed by **one clickable chip per project name** from
  `unassociated`. Each chip is a `<button>` (class `link-accent`, new minimal CSS)
  that calls `focusProject(name)`.

Sketch:

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

### B. Project row — `src/renderer/features/projects/ProjectItem.tsx:88-96`

In the collapsed `project-item__head`, when `needsAdoption`, add an accent badge
between the name and the source-count:

```tsx
;<span className="project-item__name grow">{name}</span>
{
  needsAdoption && (
    <Badge>
      <Icon name="alert" size={12} />
      {t('projects.needsSetupBadge')}
    </Badge>
  )
}
;<span className="muted">{t('projects.sourceCount', { count: folders.length })}</span>
```

`Badge` (`components/Badge.tsx`) already renders accent-weak bg / accent fg with an
inline-flex gap, so the icon + label compose without new CSS.

### C. Source rows — `src/renderer/features/projects/ProjectFolderRow.tsx:63-67`

Replace the muted "no path" span with an accent treatment (icon + accent label):

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

`.folder-row__missing` is a new minimal class (accent color + inline-flex gap),
reusing the `--accent` token (same idea as the existing `.field__hint--accent`).

### D. Navigation: banner chip → expand + scroll

`open` state is **local** to `ProjectItem` (`ProjectItem.tsx:36`). To avoid
rewriting the toggle into a controlled component (which would change today's
independent multi-open behavior), add an **additive focus signal**:

- **`Projects.tsx`** holds the signal and passes it down:

  ```tsx
  const [focus, setFocus] = useState<{ name: string; tick: number } | null>(null)
  const focusProject = (name: string) =>
    setFocus((f) => ({ name, tick: (f?.tick ?? 0) + 1 }))
  // …
  <ProjectItem
    …
    focusTick={focus?.name === name ? focus.tick : undefined}
  />
  ```

  The monotonic `tick` guarantees re-clicking the same project re-triggers the
  effect (a plain boolean would not).

- **`ProjectItem.tsx`** adds `focusTick?: number` to its props, a root ref, and an
  effect:

  ```tsx
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusTick === undefined) return
    setOpen(true)
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusTick])
  // …
  <div className="project-item" ref={rootRef}>
  ```

  On first render `focus` is `null`, so every item's `focusTick` is `undefined`
  and the effect no-ops — no unwanted auto-open/scroll on mount. `setOpen` and
  `rootRef` are stable, so `[focusTick]` is a complete, lint-clean dep array.

## i18n changes (both `en.json` and `es.json`, enforced by `parity.test.ts`)

Reword (existing keys, `projects.*`):

| key                       | English                                                                                                  | Spanish                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `unassociatedTitle_one`   | `{{count}} project needs configuring on this machine`                                                    | `{{count}} proyecto necesita configurarse en esta máquina`                                                  |
| `unassociatedTitle_other` | `{{count}} projects need configuring on this machine`                                                    | `{{count}} proyectos necesitan configurarse en esta máquina`                                                |
| `unassociatedHint`        | `Open one and use “Configure on this machine” to link its local folder — instead of creating a new one.` | `Abrí uno y usá «Configurar en esta máquina» para vincular su carpeta local — en lugar de crear uno nuevo.` |

New keys (`projects.*`):

| key               | English          | Spanish           |
| ----------------- | ---------------- | ----------------- |
| `needsSetupBadge` | `Configure here` | `Configurar aquí` |
| `focusProject`    | `Go to {{name}}` | `Ir a {{name}}`   |

Reused unchanged: `noPathOnMachine` ("no path on this machine" / "sin ruta en esta máquina").

Every new static `t()` key above must exist in both catalogs, guarded by
`i18n/keysExist.test.ts` and `i18n/parity.test.ts`.

## CSS changes

`src/renderer/theme/components.css` (after `.card--danger`, ~line 433):

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

`src/renderer/theme/screens.css` (near `.folder-row__main`, ~line 159):

```css
.folder-row__missing {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent);
}
```

No new design tokens — `--accent`, `--accent-weak`, `--border`, `--panel` all exist
(dark + light) in `tokens.css`.

## Files touched

- `src/renderer/screens/Projects.tsx` — banner rewrite + focus state.
- `src/renderer/features/projects/ProjectItem.tsx` — `focusTick` prop, head badge, root ref + effect.
- `src/renderer/features/projects/ProjectFolderRow.tsx` — accent missing-path treatment.
- `src/renderer/theme/components.css` — `.card--accent`, `.link-accent`.
- `src/renderer/theme/screens.css` — `.folder-row__missing`.
- `src/renderer/i18n/en.json`, `src/renderer/i18n/es.json` — reworded + new keys.

## Testing & verification

- **i18n** — `i18n/parity.test.ts` and `i18n/keysExist.test.ts` cover the new /
  reworded keys automatically (they run in the vitest suite).
- **No `.tsx` render tests exist** in the suite (it runs `src/**/*.test.ts` under
  the node env only), so the visual/interaction changes have no unit test. That is
  consistent with the rest of the renderer.
- **Static gates** — `npm run typecheck`, `npm run lint` (`--max-warnings 0`),
  prettier/format, all green. Core coverage is unaffected (no `core` changes).
- **Visual verification** — launch the Electron app against an isolated HOME with a
  seeded config where a project is mapped on another machine but not this one;
  screenshot the Projects screen to confirm: persistent accent banner + alert icon,
  clickable name chip, accent "Configure here" badge on the collapsed row, accent
  missing-path source rows, and that clicking a chip expands + scrolls to the
  project.

## Open micro-decisions (resolvable during implementation)

- Icon confirmed as `alert` (present in `Icon.tsx`).
- A single accent badge on the project row is enough; no extra status dot.
