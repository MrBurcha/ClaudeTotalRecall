# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Claude Total Recall — an Electron + TypeScript desktop app (with a headless CLI sharing the same core) that syncs Claude Code memory (`~/.claude/…`) across machines through a private GitHub repo, using `git`/`gh` as transport. macOS and Linux; Windows deliberately deferred.

Code identifiers, comments, commit messages, and docs are written in **English**. The UI is the only bilingual surface — English (the source language) and neutral Latin American Spanish (es-419) via react-i18next; user-facing strings live in `src/renderer/i18n/{en,es}.json`, never inline. (Releases through 0.1.4 were Spanish throughout; that convention changed with the i18n work — translate comments in files you touch.)

## Commands

```bash
npm run dev            # Electron app in dev mode (electron-vite)
npm test               # vitest run (all tests)
npx vitest run src/core/plan.test.ts   # single test file
npx vitest run -t "test name"          # single test by name
npm run typecheck      # tsc --noEmit
npm run lint           # eslint . --ext .ts,.tsx
npm run build:cli      # tsup → dist-cli/index.js (CLI, no Electron)
npm run cli:check      # build CLI + run `claude-total-recall check` (preflight: git/gh/gh-auth)
npm run build:mac      # unsigned .dmg (run on macOS)
npm run build:linux    # AppImage + deb + pacman (run on Linux or CI, no cross-build)
```

Releases: pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds unsigned artifacts on macOS + Linux runners and publishes a GitHub Release.

## Architecture

Layering rule: `src/core/` is pure Node/TypeScript with **no Electron imports** — everything else is a thin shell around it.

- `src/core/` — all logic: config, plan build/execute, outgoing/incoming, git wrapper, service orchestration, preflight, settings merge, the auto-sync engine (`syncEngine.ts`), conflict resolution, and typed errors (`errors.ts`). Tests live next to sources (`*.test.ts`) and run directly under Node (vitest, aliases `@core`/`@platform`).
- `src/platform/` — the ONLY OS-specific code. `PlatformAdapter` (linux/macos) resolves `home`, `~/.claude`, `~/.config/claudetr`, and expands `~`. Home dir is injectable for tests. Adding Windows = one more adapter + a branch in `index.ts`.
- `src/cli/` — headless entrypoint (`claude-total-recall check|connect|status|register|outgoing|incoming`), built with tsup to CJS. English-only.
- `src/main/` — Electron bootstrap, IPC handlers (`ipc.ts`), preload, the auto-sync scheduler (`syncScheduler.ts`), and the frameless window. IPC handlers are thin wrappers over `core/service.ts`.
- `src/renderer/` — React UI (`AppShell` + `screens/` + `features/` + the i18n catalog under `i18n/`), talks to main only through the preload bridge.

### Core domain model

Two verbs move files between the machine and a **working copy** (a clone of the memories repo at `~/.config/claudetr/repo`). The UI labels them **Outgoing / Saliente** and **Incoming / Entrante**; internally (the `Verb` type, CLI subcommands, commit messages) they are `outgoing`/`incoming` — renamed from the former `gather`/`scatter`:

- **outgoing** = machine → working copy → commit/pull/push
- **incoming** = working copy → machine (never touches the remote; CLI pulls first)

What syncs: user-level items (`~/.claude/CLAUDE.md`, `commands/`, `agents/`, `skills/`, `settings.json`) defined in `resolve.ts` (`USER_LEVEL_SPEC`), plus per-project sources declared in config. A project source is either a **folder** (mirrored) or a single **file** (`Project.slotKinds`, default `dir`); both map to `memories/projects/<name>/<slot>/…`. Separately, **global pinned files** (`Config.pinnedFiles`) are single files synced outside any project, at `memories/pinned/<name>`. User-level items map to `memories/user/…`. `slotKinds`/`pinnedFiles` are optional (forward-compatible: an older app ignores them).

Key invariants (preserve these when changing core):

- **Every mutating verb builds a Plan first** (`plan.ts: buildPlan`) — a dry-run of typed actions (create/overwrite/delete/noop/skip) with SHA-256 hashes. `executePlan` revalidates source hashes before applying (TOCTOU guard) and throws `PlanDriftError` if disk changed since the preview. The Electron IPC layer caches Plans by id so `plan:execute` runs exactly what the user confirmed.
- **Secrets never sync**: `plan.ts: isSecretExcluded` hard-excludes `.credentials.json`, `.claude.json`, and `*.jsonl` regardless of configuration. Defense in depth: the repo's `.gitignore` (written on init) excludes them too.
- **settings.json is computed, not copied** (`transform` actions). `settingsMerge.ts` does a shallow top-level-key split/merge: `~/.config/claudetr/settings.local.json` declares machine-local keys that never travel to the repo; on incoming, local overrides win over the shared base.
- **Config lives in the repo** (`claudetr.json`, zod-validated in `types.ts`): machines, projects, and per-machine literal paths. Local state (just `machineId`) lives outside the repo in `~/.config/claudetr/local.json`.
- **Config edits avoid JSON merge conflicts** via fetch + `reset --hard origin` + reapply + push, retried up to 6 times (`service.ts: commitConfigChange`, `registerMachine`).
- **Memory-file conflicts** (concurrent outgoing syncs) are resolved per-file as local (`--ours`) / remote (`--theirs`), then `completeConflictMerge`.

`git.ts` shells out to the `git` binary via `exec.ts` — no libgit2/isomorphic-git. Tests use local `file://` remotes; the mechanics are identical to GitHub over HTTPS/SSH.

### Internationalization (i18n)

- **Renderer** uses react-i18next with both catalogs (`i18n/en.json`, `i18n/es.json`) bundled and imported statically (`resolveJsonModule`). Init is synchronous (`initAsync: false`) so `t()` works before the first render — no flash of the wrong language. The default locale comes from `navigator.languages`; the choice persists in `localStorage['claude-total-recall:locale']`. i18next (`i18n.resolvedLanguage`) is the source of truth, not the reducer.
- **Backend errors are code + English default.** `core/errors.ts: AppError` carries a stable `code` + params + an English message. The CLI prints the message verbatim; the renderer localizes by code. Since Electron only serializes `Error.message` over `ipcMain.handle`, main re-throws AppError encoded behind a sentinel (`encodeAppError`), and the renderer decodes + localizes in `state/api.ts: normalizeError` (`t('errors.<code>', { ...params, defaultValue })`). Preflight checks carry `detailKey`/`fixKey` for the same reason.
- **Non-component modules** receive `t` as a parameter (`buildCommands(state, actions, t)`, `validateName(kind, value, t)`) or use the `i18n` singleton (`state/api.ts`, `state/useActions.ts`). Search keywords in the command palette stay bilingual literal arrays so search works in either language.

## Testing note

The memories destination is a **separate private repo**, never this code repo. `TESTING.md` documents the manual dogfooding flow end-to-end.

**vitest gotcha**: the suite runs under the `node` environment and only includes `src/**/*.test.ts` (no `.tsx` render tests). So pure modules that need translation take `t` as a parameter (tested with an identity stub), never via the DOM. `i18n/parity.test.ts` and `i18n/keysExist.test.ts` guard en/es key parity and that every static `t()` key exists in the catalog; `state/api.test.ts` guards the sentinel → localized-error pipeline.
