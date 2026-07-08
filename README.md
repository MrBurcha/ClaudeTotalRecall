<p align="center">
  <img src="build/icons/256x256.png" width="96" alt="Claude Total Recall" />
</p>

<h1 align="center">Claude Total Recall</h1>

<p align="center">
  Sync your <b>Claude Code memory</b> across machines — and keep a private, versioned
  <b>backup</b> of it — through a GitHub repo you own.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/MrBurcha/ClaudeTotalRecall/releases/latest"><img src="https://img.shields.io/github/v/release/MrBurcha/ClaudeTotalRecall" alt="Latest release" /></a>
  <a href="https://github.com/MrBurcha/ClaudeTotalRecall/actions/workflows/ci.yml"><img src="https://github.com/MrBurcha/ClaudeTotalRecall/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform: macOS | Linux" />
</p>

---

## What it is

Claude Code keeps its **memory** in `~/.claude`: your `CLAUDE.md` house rules, your custom
`commands/`, `agents/`, and `skills/`, and your `settings.json`. That state is valuable — and it
lives on one machine. Switch laptops, reinstall, or lose the disk, and it's gone.

**Claude Total Recall** gives you two things, backed by a **private GitHub repo you own**:

- **Sync across machines** — your Claude Code memory stays identical on every computer you use, kept
  up to date automatically while the app is open.
- **A versioned backup** — even on a *single* machine, you get a full **git history** of your Claude
  Code setup in your own private repo. Roll back a bad edit, audit what changed, restore after a
  reinstall.

**Secrets never travel.** A hard guard always excludes `.credentials.json`, `.claude.json`, and
`*.jsonl` transcripts — regardless of configuration — with the memories repo's own `.gitignore` as a
second layer.

It's a desktop app (Electron) that auto-syncs in the background, plus a headless CLI that shares the
same core. **macOS and Linux** (Windows is deliberately deferred).

## Screenshots

<p align="center">
  <img src="docs/screenshots/sync-home.png" width="720" alt="Sync home — your machines orbiting the memories repo" />
</p>

<p align="center">
  <img src="docs/screenshots/wizard.png" width="360" alt="Onboarding wizard" />
  <img src="docs/screenshots/projects.png" width="360" alt="Projects configuration" />
</p>

## Install

Grab the latest build from the [**Releases**](https://github.com/MrBurcha/ClaudeTotalRecall/releases/latest)
page. Builds are **unsigned** (no paid Apple/OS code-signing) — see the notes below.

### macOS (Apple Silicon)

1. Download `Claude-Total-Recall-<version>-arm64.dmg`, open it, and drag the app to **Applications**.
2. First open, because the build isn't notarized (macOS 15 Sequoia and later — the old
   *right-click → Open* was removed):
   - Double-click the app → *"Apple could not verify…"* → **Done**.
   - **System Settings → Privacy & Security**, scroll to **Security** → *"Claude Total Recall was
     blocked…"* → **Open Anyway** → confirm with Touch ID / password.

   Or clear the quarantine in one shot from a terminal:

   ```bash
   xattr -cr "/Applications/Claude Total Recall.app"
   ```

   > It's a one-time step. Opening with **no dialog at all** would require notarization with a paid
   > Apple Developer account.

### Linux

Pick the package for your distro:

```bash
# AppImage (portable — any distro)
chmod +x Claude-Total-Recall-<version>.AppImage
./Claude-Total-Recall-<version>.AppImage

# Debian / Ubuntu
sudo dpkg -i claude-total-recall_<version>_amd64.deb

# Arch
sudo pacman -U claude-total-recall-<version>.pacman
```

Prefer to build the binaries yourself? See [Build from source](#build-from-source).

## Quickstart

**You need:**

- **`git`** and **`gh`** (the [GitHub CLI](https://cli.github.com)) on your `PATH`, with `gh`
  authenticated: `gh auth login && gh auth setup-git`.
- An **empty private GitHub repo** to hold your memories — *separate from any code repo*. You don't
  have to initialize it; the app creates the structure on the first connect.

**Then, in the app:** on first launch an **onboarding wizard** walks you through it — connect the
memories repo, register this machine, and (optionally) add your first project. After that the
**Sync** screen keeps everything up to date on its own; **Advanced sync** exposes the manual
outgoing/incoming flow.

Prefer the terminal? The same flow via the CLI:

```bash
claude-total-recall check                       # preflight: git / gh / auth
claude-total-recall connect git@github.com:you/claude-memories.git
claude-total-recall register --name my-laptop
claude-total-recall outgoing                    # push this machine's memory to the repo
# …on another machine, after connect + register:
claude-total-recall incoming                    # pull the repo's memory onto this machine
```

**What syncs:** your user-level `~/.claude/CLAUDE.md`, `commands/`, `agents/`, `skills/`, and
`settings.json`, plus any **project memory folders** and **pinned files** you declare. Everything is
stored under logical names in `memories/…` inside your repo.

## CLI

The CLI ships the same core as the app and is English-only. Every command prints its result and sets
an exit code (`0` on success).

| Command | What it does |
| --- | --- |
| `check` | Preflight: verifies `git` and `gh` are installed and `gh` is authenticated. Read-only. |
| `connect <remote>` | Clone/initialize the memories repo into `~/.config/claudetr/repo` (accepts HTTPS, SSH, or `file://` remotes). On an empty repo it writes the initial structure and pushes it. |
| `status` | Local repo status: branch, ahead/behind, dirty, conflicts. Read-only. |
| `register [--name <id>]` | Register this machine in the repo config (defaults the id to your hostname). Mutates the repo. |
| `outgoing [--dry-run] [--yes]` | **machine → repo**: build a Plan, then commit + pull + push your memory. |
| `incoming [--dry-run] [--yes]` | **repo → machine**: pull first, build a Plan, then write the repo's memory onto this machine. Never touches the remote. |

Notes:

- `outgoing`/`incoming` build a **Plan (dry-run)** and ask for confirmation. `--dry-run` previews and
  touches nothing; `--yes` skips the prompt (**required** when running non-interactively, e.g. in a
  script).
- There is no per-subcommand `--help` and no version flag — `claude-total-recall` with no args (or
  `help`) prints the usage block.

Running the CLI from source: `npm run build:cli` produces `dist-cli/index.js`, then
`node dist-cli/index.js <command>`. The `check` shortcut is `npm run cli:check`.

## How it works

- **Every mutating action builds a Plan first** — a dry-run of typed actions (create / overwrite /
  delete / noop / skip) with content hashes, previewed before anything touches disk. Source hashes
  are re-validated at execution time (a TOCTOU guard).
- **Auto-sync while the app is open** — it pushes the moment a watched file changes and pulls from
  the repo on a periodic poll. The manual `outgoing`/`incoming` verbs live under **Advanced sync**.
- **`settings.json` is merged, not copied** — a shared base plus per-key machine-local overrides in
  `~/.config/claudetr/settings.local.json`. Local overrides win on incoming and never travel to the
  repo.
- **Conflicts are resolved per file** — `ours` (local) or `theirs` (remote), then finalize the merge.
- **Secrets are hard-excluded** — `.credentials.json`, `.claude.json`, `*.jsonl`, always.

## Build from source

**Requirements:** [Node.js 20](https://nodejs.org), plus `git` and `gh` as above.

```bash
git clone https://github.com/MrBurcha/ClaudeTotalRecall.git
cd ClaudeTotalRecall
npm install
npm run dev          # run the Electron app in dev mode
```

| Script | Does |
| --- | --- |
| `npm run dev` | Run the app in dev mode (electron-vite). |
| `npm test` | Run the test suite (vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run build:cli` | Build the headless CLI → `dist-cli/index.js`. |
| `npm run build:mac` | Unsigned `.dmg` → `release/` (**run on macOS**). |
| `npm run build:linux` | AppImage + deb + pacman → `release/` (**run on Linux or CI**). |

**No cross-build:** `build:mac` must run on macOS and `build:linux` on Linux. Pushing a `v*.*.*` tag
runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds the artifacts on
macOS + Linux runners and publishes a GitHub Release.

## Architecture

```
src/core/       pure logic (config, plan, outgoing/incoming, git wrapper, service,
                preflight, sync engine, conflict resolution, settings merge, typed errors).
                No Electron imports — tests run directly under Node.
src/platform/   the only OS-specific code (linux/macos adapter).
src/cli/        headless entrypoint (English-only).
src/main/       Electron bootstrap + IPC + preload + auto-sync scheduler + frameless window.
src/renderer/   React UI (AppShell + screens/ + features/) with i18n/ for the bilingual catalog.
```

The renderer UI is **bilingual** — English (source) and neutral Latin American Spanish (es-419) —
defaulting to your host locale and switchable in **Settings → Language**.

## Platform support

**macOS and Linux.** Windows is deliberately deferred (the platform layer is the only OS-specific
code, so adding it is one more adapter).

## Roadmap

- Automatic project discovery
- In-app 3-way merge editor
- Per-project timestamps
- Create the memories repo from the app
- Windows support

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, testing, and
release process.

## Security

The app is built around never syncing secrets. If you find a security issue, please see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © MrBurcha
