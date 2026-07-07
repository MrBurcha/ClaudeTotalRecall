# Claude Total Recall

Desktop app (Electron + TypeScript + React) — with a headless CLI sharing the same core —
that syncs **Claude Code memory** (`~/.claude/…`) across machines through a **private GitHub
repo**, using `git`/`gh` as transport. macOS and Linux; Windows is deliberately deferred.

## How it works (in short)

- Your **memory** (user-level `CLAUDE.md`, `commands/`/`agents/`/`skills/`, `settings.json`, plus
  the per-project memory folders you declare) is copied to/from a **working copy** of the repo
  under logical names.
- **Auto-sync runs while the app is open**: it pushes the moment a watched file changes and
  pulls from the repo on a periodic poll. Manual `gather`/`scatter` live under **Advanced sync**.
- Every mutating verb builds a **Plan (dry-run)** first, previewed before anything touches disk.
- **Merge conflicts** are resolved per file: `ours` = local, `theirs` = remote.
- **Secrets never travel**: a guard hard-excludes `.credentials.json`, `*.jsonl`, `.claude.json`.
- `settings.json` = a shared base + `settings.local.json` per-key overrides (local wins on scatter).
- The UI is **bilingual** — English and neutral Latin American Spanish (es-419). It defaults to the
  host locale and can be switched in **Settings → Language**.

## Requirements

`git` and `gh` (GitHub CLI) authenticated (`gh auth login && gh auth setup-git`). The
`claude-total-recall check` command (or the Settings screen) verifies everything.

## Development

```bash
npm install
npm run dev          # Electron app in dev mode
npm test             # vitest suite (core + git + orchestration + i18n)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --ext .ts,.tsx
```

## First run

On first launch an **onboarding wizard** walks you through: connect the memories repo, register
this machine, and (optionally) add your first project. After that, the **Sync** screen keeps
everything up to date on its own; **Advanced sync** exposes the manual gather/scatter flow.

## Headless CLI (same core as the UI)

```bash
npm run build:cli
node dist-cli/index.js check                    # preflight: git/gh/auth
node dist-cli/index.js connect <remote-url>     # clone/initialize the repo
node dist-cli/index.js status                   # repo status
node dist-cli/index.js register --name <id>     # register this machine
node dist-cli/index.js gather  [--dry-run] [--yes]   # machine → repo
node dist-cli/index.js scatter [--dry-run] [--yes]   # repo → machine
```

## Packaging (ad-hoc signing, personal use)

```bash
npm run build:mac    # release/Claude Total Recall-<v>-arm64.dmg   (verified)
npm run build:linux  # AppImage + deb + pacman  (run on Linux or CI, no cross-build from macOS)
```

### macOS: install and open

Builds are **ad-hoc** (no Developer ID certificate, no Apple notarization). The ad-hoc signature
(see `scripts/afterPack.cjs`) seals the bundle resources so macOS does **not** flag it as
*"damaged"* on Apple Silicon. Because it isn't notarized, downloading the `.dmg` from a GitHub
Release (which attaches the quarantine attribute) prompts for a manual OK on first open. On
**macOS 15 (Sequoia) and later** the old *"right-click → Open"* was **removed**; the current flow is:

1. Double-click → *"Apple could not verify…"* → **Done**.
2. **System Settings → Privacy & Security**, scroll to the **Security** section: you'll see
   *"Claude Total Recall was blocked…"* → **Open Anyway**.
3. Confirm with Touch ID / password → **Open**. It's a one-time step; afterwards it opens normally.

Terminal shortcut (clears quarantine in one shot):

```bash
xattr -cr "/Applications/Claude Total Recall.app"
```

> To open with **no dialog at all** (like App Store apps) you need **notarization** with a paid
> Apple Developer account; ad-hoc signing isn't enough.

## Layout

- `src/core/` — pure logic (config, plan, gather/scatter, git, service, preflight, sync engine,
  conflict resolution, settings merge, error codes). No Electron imports.
- `src/platform/` — the only OS-specific code (linux/macos adapter).
- `src/cli/` — headless entrypoint.
- `src/main/` — Electron bootstrap + IPC + preload + the auto-sync scheduler + frameless window.
- `src/renderer/` — React UI (`AppShell` + `screens/` + `features/`), with `i18n/` for the
  bilingual catalog.

## Pending / follow-ups

- Validate the full cycle against a **real private GitHub repo** (tests use local `file://`
  remotes; the mechanics are identical).
- Build the **Linux** artifacts on a Linux machine or in CI.
- v1.1+: automatic project discovery, in-app 3-way merge editor, per-project timestamps,
  create the repo from the app, Windows.
