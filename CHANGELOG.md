# Changelog

All notable changes to Claude Total Recall are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
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
- **Renamed the sync verbs** `gather`/`scatter` → **`outgoing`/`incoming`** (UI: *Outgoing / Saliente*
  and *Incoming / Entrante*). The rename spans the UI, the `Verb` type, CLI subcommands
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
  + `scripts/make-background.sh`, wired as `npm run background`), now carrying the new product
  name.
- Documentation (README, TESTING, CHANGELOG, `CLAUDE.md`, `build/README`) rewritten in English.

## [0.1.4] - 2026-07-06

### Fixed
- **The DMG background didn't show on macOS 26.2.** It wasn't an artwork or config problem:
  macOS 26.2 stopped resolving the `pBBk` (background *bookmark*) record that `dmgbuild` wrote
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
  the "Apple could not verify…" notice appears. On **macOS 15+** the old *right-click → Open* was
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

[Unreleased]: https://github.com/MrBurcha/ClaudeTotalRecall/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.2.0
[0.1.5]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.5
[0.1.4]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.4
[0.1.3]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.3
[0.1.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.2
[0.1.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.1
[0.1.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.0
