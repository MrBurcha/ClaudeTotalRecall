# Changelog

All notable changes to Claude Total Recall are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.9.3] - 2026-07-10

### Fixed

- **Recent Activity: the `MEMORY.md` help icon was shown inconsistently** (#82): the ⓘ icon that
  opens the memory-maintenance help was gated by an event-level `received` flag — true only for an
  `incoming` event or another machine's `outgoing` push, never your own push. A self-synced
  `MEMORY.md` row never showed the icon, regardless of whether it was added, updated, or deleted,
  since every file status shares the same row renderer and gate. The icon's visibility now depends
  solely on the file being `MEMORY.md`, so it always shows — including on deletion, since removing
  the index is the strongest signal it may need regenerating.

## [0.9.2] - 2026-07-10

### Fixed

- **Auto-sync's incoming step could still clobber a fresh edit — a second race #77 didn't cover**
  (#80): `destinationDrifted` (#77) protects the window between a Plan's build and its execute, but
  not the window between a single auto-sync cycle's own outgoing and incoming phases. Phase 1
  (outgoing) can include a real commit/pull/push (a multi-second network round trip); an edit
  landing after that phase's Plan was built — so it never captured it — but before the incoming
  phase builds its own Plan gets silently overwritten, because the incoming Plan's hash already
  reflects the fresh edit at build time, so nothing looks "drifted" to it. Fixed by re-checking the
  machine's own hashes right before building the incoming Plan, comparing against what the
  outgoing phase already captured; if anything changed, incoming is skipped for that cycle (the
  edit itself already queued the next cycle, which then settles cleanly). Reproduced live against
  the real app and covered by a deterministic regression test.

## [0.9.1] - 2026-07-09

### Fixed

- **Auto-sync's incoming step could silently clobber a fresh local edit** (#77): `executePlan`
  revalidated the Plan's source hash before applying (TOCTOU guard), but never the destination.
  An auto-sync cycle builds an `incoming` Plan and executes it moments later, after an `outgoing`
  phase that does a real git pull/push — if a local edit landed on a machine file in that window,
  the stale Plan blindly overwrote it, with no error and no conflict (conflict detection is
  git-based, and the edit never made it into git). `executePlan` now also revalidates the
  destination for `create`/`overwrite`/`delete` actions, aborting with the same `PlanDriftError`
  so the caller rebuilds a fresh Plan instead of overwriting.

## [0.9.0] - 2026-07-09

### Added

- **In-app help for reconciling `MEMORY.md` after a cross-machine sync** (#73):
  when two machines held different memories and synced, the `MEMORY.md` index can
  end up matching only the machine that synced last. A reusable help modal now
  offers a maintenance prompt (ready to copy) to reconcile the index in Claude
  Code, surfaced at two moments — next to a `MEMORY.md` that arrived from another
  machine in Recent activity, and when you save a project source that contains a
  `MEMORY.md` on a project already configured on another machine. The same
  guidance is in the README, and the copy is explicit that a normal propagated
  update needs no action.

### Changed

- **The "project configured on another machine" notice now makes clear which
  project needs attention** (#71): on the Projects screen the banner is a
  persistent accent card with an alert icon and lists the affected project(s) as
  clickable chips that expand and scroll to the project; each project that isn't
  set up on this machine carries a "Configure here" badge on its collapsed row so
  you can spot it without expanding; and inside a project, every source with no
  local path on this machine is highlighted in accent instead of muted gray.
  Presentation only — no change to sync, config, or the data model.

### Fixed

- **macOS DMG: window still clipped the background** (#70): #67/#69 sized the background at
  640×528 to clear the ~28px title bar, but that wasn't the whole story. `dmgbuild`'s `.DS_Store`
  also asks Finder to hide the path bar and status bar for this window, and on macOS 26.2 Finder
  ignores that whenever the user has those View-menu toggles on globally — confirmed against a
  real machine with both enabled, where they render stacked at the bottom of the window, clipping
  the "doesn't open the first time?" card regardless of the title-bar-only math. The background is
  now generated at 640×604, with most of the added headroom below the design (plus a small cushion
  under the title bar) so the full card survives that extra chrome either way.
- **macOS DMG: internal resource file still visible with "Show Hidden Files" on** (#70, follow-up
  to #67): `harden-dmg.sh` hid `.background.tiff`/`.DS_Store` via the classic Finder invisible bit
  (`SetFile -a V`), on the assumption that bit survives Finder's "Show Hidden Files" toggle
  (Cmd+Shift+.) — that stopped being true after Sierra; the toggle reveals it just like a
  dot-prefix or `chflags hidden` file. As a second layer, the script now also asks Finder (via
  AppleScript) to move each hidden item far outside the background's visible canvas while the
  volume is still mounted read-write, so forcing hidden files on shows it off-screen instead of
  overlapping the design. Non-fatal if Finder scripting isn't permitted in a given environment —
  falls back to the invisible bit alone, same as before.

## [0.8.1] - 2026-07-09

### Fixed

- **Adopting a project on a second machine could nest `memory/` inside itself** (#68):
  the inline folder editor and the cross-machine "adopt" picker let you pick a
  project's root folder for a `memory` slot instead of its `memory/` subfolder,
  producing `memories/projects/<name>/memory/memory/…` on the remote and sync
  ping-pong between machines. A new `correctProjectFolderPick` helper detects when
  a pick is a project root containing the slot's leaf folder and auto-corrects it
  at pick time (in both pickers), with an undoable inline notice — detection is
  name/structure based and never silently overrides a same-machine save.
- **macOS DMG: undersized window + stray "TIFF" icon over the background** (#67):
  `dmg-builder` (electron-builder's DMG target) ignores `dmg.window` whenever
  `dmg.background` is set — it derives the DMG window's total size from the
  background image's own pixel dimensions instead. The background is now generated
  at 640×528 (was 640×500), reserving the ~28px title bar so the design shows in
  full without resizing or scrolling. Separately, the release pipeline now runs a
  new `scripts/harden-dmg.sh` step (macOS only) after building the `.dmg` that
  applies the real Finder "invisible" attribute (`SetFile -a V`) to everything in
  the volume except the app and the `Applications` alias — the internal background
  resource was only hidden by dot-prefix convention, which Finder's "Show Hidden
  Files" toggle reveals.

## [0.8.0] - 2026-07-09

### Fixed

- **Scan dialog named projects after Claude's dir, not the project** (#61): the "Already synced
  here" section named already-configured projects after their `~/.claude/projects` directory slug
  (e.g. `core`, `app`) instead of their configured canonical name (e.g. `Zimbify`). The canonical
  name now travels structurally with the path-based match and is shown; the raw slug stays literal
  beside it.

### Added

- **Assisted cross-machine reconciliation** (#61): adopting a project on a second machine no longer
  pre-fills a phantom home-remapped path for a `~/.claude/projects` source (Claude names those dirs
  differently per machine) — it offers ranked local candidates to pick instead. The Projects view
  and the New-project flow now non-blockingly invite associating an existing project instead of
  creating a duplicate, ranked by a deterministic name-match score.

### Changed

- **Project names are now case-insensitive for uniqueness** (#61): a project's name is its identity
  (the literal `memories/projects/<name>/` folder), so creating or renaming one whose name
  case-collides with an existing project is rejected — preventing `Zimbify` and `zimbify` from
  mapping to the same folder on a case-insensitive filesystem. Existing names are never rewritten.

### Security

- **esbuild advisory patched tree-wide + least-privilege CI token** (#64): forced `esbuild` to
  `^0.28.1` via a global npm override (a dev-only dependency, never shipped in the
  `.dmg`/AppImage/deb/pacman) to clear the GHSA-g7r4-m6w7-qqqr dev-server advisory, deduping the
  tree to a single `esbuild@0.28.1`. Added a least-privilege `permissions: contents: read` block to
  `ci.yml` (CodeQL `actions/missing-workflow-permissions`).

## [0.7.1] - 2026-07-08

### Changed

- **electron-builder 25 → 26** (+ `tar` 7) (#63): the macOS DMG-background workaround for the
  macOS 26.2+ regression (Finder no longer resolving the `pBBk` bookmark, #9072) moves from our
  hand-maintained `patch-package` patch to **upstream**: electron-builder 26 bundles `dmgbuild`
  v1.6.7, which drops the `pBBk` write itself. The patch is removed as redundant, and DMGs now
  also build as APFS on Apple Silicon (avoiding the Tahoe HFS+ mount bug). No app-runtime change.

### Fixed

- **Release pipeline no longer drops a platform's artifact** (#60): the macOS and Linux jobs each
  ran `electron-builder --publish always` in parallel and both tried to create the GitHub Release,
  a race that left two drafts for one tag and stranded the macOS `.dmg` (seen on v0.7.0). A new
  `create-release` job now creates the draft once, up front, and both builds upload into it.

### Documentation

- **CONTRIBUTING**: documented the PR-based workflow and the `main` branch protections (#62).

## [0.7.0] - 2026-07-08

### Added

- **Auto-discover project sources + cross-machine adoption** (#54): configuring a project no longer
  means adding each slot by hand, per machine. Pick a folder and an opinionated recognizer proposes a
  project name and slots from the Claude-memory vocabulary (`memory/`, `commands/`, `agents/`,
  `skills/`, `CLAUDE.md`, `settings.json`) — review, then confirm. When the project already exists on
  another machine, adopting it there is one click → review the mapping → confirm (OS-aware paths),
  instead of "no path on this machine" and re-picking slot by slot.
- **Bulk-scan `~/.claude/projects`** (#55): "New project" now opens a chooser — **Scan** / **Pick a
  folder** / **Create empty**. Scan runs the recognizer over every `~/.claude/projects/*` subdir and
  shows a checklist grouped into **Ready to sync** (already has `memory/`, pre-checked) and **No
  memory yet** (checking one creates its `memory/` folder and starts syncing) — so you can set up many
  projects at once instead of one folder at a time.

### Changed

- **Electron 33 → 43** (#58): the app's runtime jumps ten majors to a current Chromium and Node. The
  app's Electron API usage type-checks against the new types, and the built app boots and renders with
  no console errors.

### Dependencies

- **Build toolchain**: Vite 5 → 7, electron-vite 2 → 5 (drops the deprecated `externalizeDepsPlugin`,
  now the default), @vitejs/plugin-react 4 → 5 (#57). Vite 8 was held back — no stable electron-vite
  supports it yet, so 7 is the furthest-forward stable target.
- **Test toolchain**: Vitest 2 → 4 (#56), migrating the removed `environmentMatchGlobs` to per-file
  `@vitest-environment` docblocks on the component tests.
- `i18next` 26.3.4 → 26.3.5 and `@typescript-eslint/*` 8.62 → 8.63 (#50); CI actions `setup-node`
  4 → 6 (#45) and `checkout` 4 → 7 (#46).
- **Held**: electron-builder 26 / tar 7 (#48). electron-builder 26 rewrote dmg-builder to download a
  prebuilt binary, which drops the vendored source our macOS DMG-background workaround (#9072) patches
  — so we stay on electron-builder 25 until the background can be preserved another way.

### Internal

- **Prettier pre-commit hook** (#59): `npm install` now enables a versioned `.githooks/pre-commit`
  (via a `prepare` script that sets `core.hooksPath`) that runs Prettier on staged files, so a
  formatting slip can't reach `main` and break the CI `format:check` job. No new dependencies.

## [0.6.0] - 2026-07-08

### Added

- **Preview a file's content from Recent activity** (#43): every file in the feed is now a link
  (underlined, no color change, pointer on hover). Clicking it opens a scrollable modal that previews
  the file, formatted by type — rendered **markdown** (GFM tables, code blocks, blockquotes),
  pretty-printed **JSON**, **`.properties`/`.env`** key–value, or **plain text** — auto-detected by
  extension, with a manual renderer switcher. An **"Open location"** button reveals the file's real
  source on this machine (its configured path, not the app's internal repo) in Finder / the default
  Linux file manager. Content is read from the synced working copy — so hard-excluded secrets can't
  be surfaced — and guarded against path traversal, oversized files (1 MiB cap), and binary blobs;
  the reveal path is re-derived server-side, never trusted from the UI.

## [0.5.0] - 2026-07-08

### Added

- **"Last change" summary in Recent activity** (#39): when the panel is collapsed, a one-line peek
  under the header — "last change {time} · {N} files · {where}" — shows the last time real memory
  actually moved (how many files, and which project / user level / pinned bucket), derived from the
  newest sync entry that changed something (structural `.gitkeep` noise ignored). It lets you tell at
  a glance whether it's worth expanding, and hides once the timeline is open.

### Changed

- **Honest "last checked" on the Sync home** (#39): the status card's sub-line read "last synced",
  but that timestamp bumps on _every_ successful poll even when nothing changed — being up to date
  isn't the same as having just changed something. It now reads **"last checked"**, which is what it
  always measured. The real "last change" story moved to Recent activity (above).

### Documentation

- **"What gets synced (and what to back up)" README guide** (#40): a user-manual section documenting
  the sync allowlist (user-level items, project sources, pinned files), the hard-excluded secrets
  (`.credentials.json`, `.claude.json`, `*.jsonl`), the machine-local state the app deliberately
  skips, and how to back up a git-ignored `.env` via pinned files or a project file source — with
  strong caveats. It opens with a prominent reminder to keep your own local backups too: Claude
  Code's internal layout is Anthropic's and can change in ways the app can't anticipate, and the
  private, versioned repo is your rollback hatch if it does.

## [0.4.3] - 2026-07-07

### Changed

- **Recent activity / Advanced typography** (#8): fixed the font hierarchy on the Sync home. The
  collapsible panel titles ("Recent activity", "Advanced") were rendering smaller than the row labels
  inside them, and each per-file group heading was smaller than the filenames it groups. Panel titles
  are now proper section headers (on par with the sync status), group headings sit a step above their
  files, and the status labels are no longer sub-11px — so the feed reads with a clear top-to-bottom
  hierarchy (16 → 14 → 12.5 px) instead of a flat cluster of tiny text.

## [0.4.2] - 2026-07-07

### Fixed

- **Recent activity hides `.gitkeep` placeholders** (#8): the empty `memories/**` dirs are seeded
  with `.gitkeep` files that the first sync then deletes; the feed was listing those deletions as
  spurious "removed" rows and inflating the file count. They are now filtered out, so an entry shows
  only real memory files (e.g. "2 files" instead of "5").

## [0.4.1] - 2026-07-07

### Changed

- **Development tooling hardened** (no user-facing changes): stricter ESLint (React-hooks rules and
  type-aware promise checks, with warnings failing CI), Prettier enforced in CI, code-coverage
  measurement with a threshold on the core, and new automated tests for the CLI and UI components.

## [0.4.0] - 2026-07-07

### Added

- **Recent activity records real incoming syncs** (#8): pulling shared memory onto this machine now
  leaves a trace. Incoming never commits or touches the remote, so it is logged locally
  (`~/.config/claudetr/activity.local.json`, outside the repo, never synced) and merged into the
  history. The feed shows "Downloaded to this machine · from `<machine>`", attributed by classifying
  the commits the pull brought in — so you finally see what this machine _received_, not only what
  each machine pushed.

### Changed

- **Recent activity reads in the user's vocabulary** (#8): file changes are grouped by project /
  user level / pinned files with friendly names and just the file name, instead of the internal repo
  path (`projects/<name>/<slot>/…`). The Git-style `+` / `~` / `−` glyphs are replaced by colored
  status labels (Added / Updated / Removed). Each entry is attributed to its machine by name, and the
  direction is honest — a machine _contributed to shared memory_ (↓ from another machine) vs this
  machine _downloaded_ it (↙) — instead of a misleading up/down arrow relative to this machine.

## [0.3.0] - 2026-07-07

### Fixed

- **DMG volume icon** (#18, stopgap): the mounted installer no longer shows the app icon squished
  into the disk. `dmg.icon` is now explicit `null`, so macOS renders its generic removable-disk
  icon. A branded drive icon is deferred to #18 (pending the visual-identity cleanup in #9).

### Changed

- **Unified the app's brand mark** (#9): the sidebar, About dialog and onboarding wizard now show the
  real app icon as a rounded tile (CSS bezel) instead of the old orbit/oval glyph, which is removed
  from the icon set. The mark is a single swappable asset (`build/icon.png` → `npm run icons`), and the
  navigation/actions that used the orbit glyph now use the sync icon.
- **Recent activity now lists the files touched by each sync** (#8): every `outgoing` entry expands
  to show the files added / modified / deleted (from `git log --name-status`, with colored `+` / `~` /
  `−` markers), and the history fetch cap was raised from 20 to 100. Config entries (pin, register,
  set/remove source) keep their semantic label without the redundant `claudetr.json` line.

## [0.2.0] - 2026-07-07

### Added

- **File sources for projects** (#11): a project source can now be a single **file**, not only a
  folder. When adding a source you pick its kind (folder or file); a file source syncs as one
  file (never mirror-deleted) to `memories/projects/<project>/<slot>`. Stored per project as
  `slotKinds` (optional, defaults to `dir`, so older app versions ignore it).
- **Global pinned files** (#11): single files synced globally, outside any project (e.g. a
  specific `CLAUDE.md`), managed in **Settings → Pinned files** and stored under
  `memories/pinned/<name>`. Secrets (`.credentials.json`, `.claude.json`, `*.jsonl`) are still
  hard-excluded, and the same nesting guard rejects a file already covered by a synced folder.
- **Recent activity** (#8): a collapsible timeline on the Sync home, derived from the memories
  repo's git log and classified into typed entries (outgoing ↑/↓ with machine + file count,
  set/remove source, project created/deleted/renamed, machine registered, file pinned/unpinned,
  conflicts resolved). Direction shows ↑ for this machine and ↓ for another.

### Changed

- **Renamed the sync verbs** `gather`/`scatter` → **`outgoing`/`incoming`** (UI: _Outgoing / Saliente_
  and _Incoming / Entrante_). The rename spans the UI, the `Verb` type, CLI subcommands
  (`claude-total-recall outgoing|incoming` — the old `gather`/`scatter` subcommands are gone),
  and commit messages (`Claude Total Recall: outgoing on <machine>`). Command-palette search still
  matches the old terms.

## [0.1.5] - 2026-07-06

### Added

- **Bilingual UI** (react-i18next): English and neutral Latin American Spanish (es-419). Every
  user-facing string now lives in the `en`/`es` catalogs under `src/renderer/i18n/` (never
  inline). The language defaults to the host locale (`navigator.languages`), can be switched
  live in **Settings → Language**, and the choice persists per machine (`localStorage`). i18n
  init is synchronous, so there is no flash of the wrong language on startup.

### Changed

- **Renamed to Claude Total Recall** everywhere user-facing — product name, window title, DMG
  background, documentation, and the `claude-total-recall` CLI/package (was `claudetr`). On-disk
  config (`~/.config/claudetr`, `claudetr.json`) is left untouched, so existing setups keep
  syncing without any migration.
- **Backend errors carry stable codes** (`AppError`): the core/CLI emit an English default
  message plus a machine-readable code, and the renderer localizes by code across the IPC
  boundary (main encodes behind a sentinel, `state/api.ts` decodes and localizes). Preflight
  checks carry `detailKey`/`fixKey` for the same reason. The CLI is now fully English.
- **Convention switched to English** for code identifiers, comments, and commit messages; the
  UI is the only bilingual surface (English is the source language).
- **DMG installation background regenerated** from an HTML template (`scripts/background.html`
  - `scripts/make-background.sh`, wired as `npm run background`), now carrying the new product
    name.
- Documentation (README, TESTING, CHANGELOG, `CLAUDE.md`, `build/README`) rewritten in English.

## [0.1.4] - 2026-07-06

### Fixed

- **The DMG background didn't show on macOS 26.2.** It wasn't an artwork or config problem:
  macOS 26.2 stopped resolving the `pBBk` (background _bookmark_) record that `dmgbuild` wrote
  into the `.DS_Store`, leaving the DMG without a background (this affects all installers, not
  just this one — see electron-builder #9072). We patch `dmgbuild` (via `patch-package`) to stop
  writing that bookmark; the `backgroundImageAlias` remains, which macOS 26.2 does resolve. The
  volume now mounts with a versioned name ("Claude Total Recall x.y.z") so Finder always reads a fresh
  `.DS_Store`.

## [0.1.3] - 2026-07-06

### Added

- **DMG with an installation background.** Opening the image shows a guided window: the
  **Claude Total Recall → Applications** drag with an arrow, and a card with the **two ways to open** the
  app on macOS (Settings → Privacy & Security → "Open Anyway", or `xattr -cr`). It follows the
  "Sync station" visual identity (dark, periwinkle, constellation).

## [0.1.2] - 2026-07-06

### Fixed

- **macOS: the `.dmg` no longer opens as a "damaged application" on Apple Silicon.** The bundle
  was generated without going through `codesign` (`identity: null`), so it only had the
  linker-signed signature on the executable, with no sealed resources; with the quarantine macOS
  attaches to downloads, Gatekeeper read it as tampered. Now an `afterPack` hook
  (`scripts/afterPack.cjs`) signs the bundle **ad-hoc** (`codesign --force --deep --sign -`)
  before building the `.dmg`, sealing the resources and removing the "damaged" verdict.

### Notes

- Builds remain **unnotarized** (personal use, no Apple Developer account). On a fresh download
  the "Apple could not verify…" notice appears. On **macOS 15+** the old _right-click → Open_ was
  removed; open from **System Settings → Privacy & Security → "Open Anyway"** (a one-time step),
  or clear the quarantine with `xattr -cr "/Applications/Claude Total Recall.app"`. For zero dialogs you need
  notarization (paid).

## [0.1.1] - 2026-07-05

### Added

- Custom title bar (frameless window): removes the native menu and fixes the Linux icon.
- Automatic sync with a baseline engine, one-button sync, and an **Advanced** panel.
- **"Sync station"** redesign of the renderer (dark/constellation visual identity).

### Changed

- Creating an already-existing project is idempotent and guides you to its card.

## [0.1.0] - 2026-07-05

### Added

- First release of Claude Total Recall: Electron app + headless CLI to sync Claude
  Code memory (`~/.claude/…`) across machines via a private GitHub repo, with `git`/`gh` as
  transport.
- `gather`/`scatter` verbs with a Plan (dry-run) preview, secret guard, and `settings.json` merge
  (shared base + local overrides).
- macOS (`.dmg`) and Linux (AppImage + deb + pacman) packaging, published by CI on pushing a
  `v*.*.*` tag.

[Unreleased]: https://github.com/MrBurcha/ClaudeTotalRecall/compare/v0.9.3...HEAD
[0.9.3]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.9.3
[0.9.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.9.2
[0.9.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.9.1
[0.9.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.9.0
[0.8.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.8.1
[0.8.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.8.0
[0.7.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.7.1
[0.7.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.7.0
[0.6.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.6.0
[0.5.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.5.0
[0.4.3]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.4.3
[0.4.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.4.2
[0.4.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.4.1
[0.4.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.4.0
[0.3.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.3.0
[0.2.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.2.0
[0.1.5]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.5
[0.1.4]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.4
[0.1.3]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.3
[0.1.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.2
[0.1.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.1
[0.1.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.0
