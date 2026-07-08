# Contributing

Thanks for your interest in Claude Total Recall! This is a small project — issues and pull requests
are welcome.

## Development setup

Requirements: [Node.js 20](https://nodejs.org), plus `git` and `gh` (authenticated with
`gh auth login && gh auth setup-git`).

```bash
git clone https://github.com/MrBurcha/ClaudeTotalRecall.git
cd ClaudeTotalRecall
npm install
npm run dev
```

Before opening a pull request, make sure the checks pass (the same three run in CI on every PR):

```bash
npm run typecheck
npm run lint
npm test
```

## Conventions

- **English** for code identifiers, comments, commit messages, and docs. The UI is the only
  bilingual surface — English (source) and neutral Latin American Spanish (es-419); user-facing
  strings live in `src/renderer/i18n/{en,es}.json`, never inline.
- **Layering:** `src/core/` is pure Node/TypeScript with **no Electron imports** — the CLI, main
  process, and renderer are thin shells around it. OS-specific code goes in `src/platform/`.
- **Every mutating action builds a Plan first** (a dry-run of typed actions with content hashes);
  preserve that invariant when changing core.
- **Secrets never sync** — `.credentials.json`, `.claude.json`, and `*.jsonl` are hard-excluded.
  Don't weaken that guard.

## Testing

Tests live next to their sources (`*.test.ts`) and run under Node (vitest, `node` environment — no
DOM). Pure modules that need translation take `t` as a parameter (tested with an identity stub)
rather than reaching into the DOM.

**When you touch the UI, verify both locales** (English and es-419). The language toggle is live (no
restart) and the `<html lang>` attribute follows the selection.

### Dogfooding

The quickest way to exercise a change end-to-end is to sync this project's own memory. Create an
**empty private** repo (e.g. `github.com/<you>/claude-memories` — *never* the code repo), then run
the onboarding wizard (or the CLI: `connect` → `register` → add a project → `outgoing`) against it,
and confirm on GitHub that `memories/…` shows up with **no** credentials or transcripts.

## Releases

Releases are driven by tags:

1. Bump the version: `npm version <x.y.z> --no-git-tag-version`.
2. Move the `[Unreleased]` section of `CHANGELOG.md` into a new `[x.y.z]` section (and add its link at
   the bottom of the file).
3. Commit, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

Pushing the `v*.*.*` tag triggers `.github/workflows/release.yml`, which builds the unsigned
artifacts on macOS + Linux runners and publishes a GitHub Release, using the matching CHANGELOG
section as the release notes.
