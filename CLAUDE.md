# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ClaudeTR (Claude Total Recall) — an Electron + TypeScript desktop app (with a headless CLI sharing the same core) that syncs Claude Code memory (`~/.claude/…`) across machines through a private GitHub repo, using `git`/`gh` as transport. macOS and Linux; Windows deliberately deferred.

Comments, commit messages, UI strings, and docs are written in Spanish (rioplatense). Follow that convention.

## Commands

```bash
npm run dev            # Electron app in dev mode (electron-vite)
npm test               # vitest run (all tests)
npx vitest run src/core/plan.test.ts   # single test file
npx vitest run -t "nombre del test"    # single test by name
npm run typecheck      # tsc --noEmit
npm run lint           # eslint . --ext .ts,.tsx
npm run build:cli      # tsup → dist-cli/index.js (CLI, no Electron)
npm run cli:check      # build CLI + run `claudetr check` (preflight: git/gh/gh-auth)
npm run build:mac      # unsigned .dmg (run on macOS)
npm run build:linux    # AppImage + deb + pacman (run on Linux or CI, no cross-build)
```

Releases: pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds unsigned artifacts on macOS + Linux runners and publishes a GitHub Release.

## Architecture

Layering rule: `src/core/` is pure Node/TypeScript with **no Electron imports** — everything else is a thin shell around it.

- `src/core/` — all logic: config, plan build/execute, gather/scatter, git wrapper, service orchestration, preflight, settings merge. Tests live next to sources (`*.test.ts`) and run directly under Node (vitest, aliases `@core`/`@platform`).
- `src/platform/` — the ONLY OS-specific code. `PlatformAdapter` (linux/macos) resolves `home`, `~/.claude`, `~/.config/claudetr`, and expands `~`. Home dir is injectable for tests. Adding Windows = one more adapter + a branch in `index.ts`.
- `src/cli/` — headless entrypoint (`claudetr check|connect|status|register|gather|scatter`), built with tsup to CJS.
- `src/main/` — Electron bootstrap, IPC handlers (`ipc.ts`), preload. IPC handlers are thin wrappers over `core/service.ts`.
- `src/renderer/` — React UI (single `App.tsx`), talks to main only through the preload bridge.

### Core domain model

Two verbs move files between the machine and a **working copy** (a clone of the memories repo at `~/.config/claudetr/repo`):

- **gather** = machine → working copy → commit/pull/push
- **scatter** = working copy → machine (never touches the remote; CLI pulls first)

What syncs: user-level items (`~/.claude/CLAUDE.md`, `commands/`, `agents/`, `skills/`, `settings.json`) defined in `resolve.ts` (`USER_LEVEL_SPEC`), plus per-project folders declared in config. They map to logical paths `memories/user/…` and `memories/projects/<name>/<slot>/…` in the repo.

Key invariants (preserve these when changing core):

- **Every mutating verb builds a Plan first** (`plan.ts: buildPlan`) — a dry-run of typed actions (create/overwrite/delete/noop/skip) with SHA-256 hashes. `executePlan` revalidates source hashes before applying (TOCTOU guard) and throws `PlanDriftError` if disk changed since the preview. The Electron IPC layer caches Plans by id so `plan:execute` runs exactly what the user confirmed.
- **Secrets never sync**: `plan.ts: isSecretExcluded` hard-excludes `.credentials.json`, `.claude.json`, and `*.jsonl` regardless of configuration. Defense in depth: the repo's `.gitignore` (written on init) excludes them too.
- **settings.json is computed, not copied** (`transform` actions). `settingsMerge.ts` does a shallow top-level-key split/merge: `~/.config/claudetr/settings.local.json` declares machine-local keys that never travel to the repo; on scatter, local overrides win over the shared base.
- **Config lives in the repo** (`claudetr.json`, zod-validated in `types.ts`): machines, projects, and per-machine literal paths. Local state (just `machineId`) lives outside the repo in `~/.config/claudetr/local.json`.
- **Config edits avoid JSON merge conflicts** via fetch + `reset --hard origin` + reapply + push, retried up to 6 times (`service.ts: commitConfigChange`, `registerMachine`).
- **Memory-file conflicts** (concurrent gathers) are resolved per-file as local (`--ours`) / remote (`--theirs`), then `completeConflictMerge`.

`git.ts` shells out to the `git` binary via `exec.ts` — no libgit2/isomorphic-git. Tests use local `file://` remotes; the mechanics are identical to GitHub over HTTPS/SSH.

## Testing note

The memories destination is a **separate private repo**, never this code repo. `TESTING.md` documents the manual dogfooding flow end-to-end.
