# Testing Claude Total Recall by dogfooding (syncing this very project's memory)

> `ClaudeTotalRecall` is the app's **code**. The **memories destination** is a **separate,
> private, empty** repo. Never sync memories into the code repo.

## 0. Requirements

`git`, `gh` authenticated (`gh auth status`), `npm install` done. Verify with:

```bash
npm run cli:check      # git ✓ / gh ✓ / gh-auth ✓
```

## 1. Create the memories repo (empty, private)

```bash
gh repo create MrBurcha/claude-memories --private
```

No need to initialize it with anything: Claude Total Recall creates the structure on the first connect.

## 2. Launch the app

In WebStorm: the **dev** run configuration. Or from a terminal:

```bash
npm run dev
```

On first launch an **onboarding wizard** guides you through the steps below (connect → register →
first project); you can also do them from the individual screens as described here.

## 3. Connect the repo (Settings)

**Settings → Repo** → paste `https://github.com/MrBurcha/claude-memories.git` → **Connect**.
The app clones, creates `claudetr.json` + `memories/…`, and makes the first push.

## 4. Register this machine (Machines)

**Machines → Register this machine** → a logical name, e.g. `mac-studio`.

## 5. Add the Claude Total Recall project (Projects)

**Projects → Add project/slot**:
- Logical name: `claude-total-recall`
- Slot: `memory`
- **Choose folder…** → navigate to:
  `~/.claude/projects/-Users-your-user-Projects-ClaudeTotalRecall/memory`

The **literal** path for this machine is stored.

## 6. Gather (Sync → Advanced sync)

**Sync → Advanced sync → Gather** → review the **Plan preview** (create/overwrite/noop/skip) →
**Confirm**. It uploads:
- user-level memory: `~/.claude/CLAUDE.md`, `commands/`, `agents/`, `skills/`, `settings.json` (sanitized)
- the `claude-total-recall` project memory

The **guard** always excludes `.credentials.json`, `*.jsonl`, and `.claude.json`.

Note: with **auto-sync** enabled (the default), the app pushes on file changes and pulls on a
periodic poll on its own — the manual gather/scatter above is the **Advanced sync** escape hatch.

## 7. Verify on GitHub

Open `github.com/MrBurcha/claude-memories` and confirm:
- `claudetr.json` with your machine and the `claude-total-recall` project
- `memories/user/…` and `memories/projects/claude-total-recall/memory/…`
- **no** credentials or transcripts

## 8. Round-trip (optional, with a second machine)

On the other machine: **Settings → Connect** the same repo → **Machines → Register** (another name)
→ **Projects → Add** `claude-total-recall/memory` with **its** local path → **Sync → Advanced sync → Scatter**
→ the memory lands on that machine. If you edited the same memory on both sides, the app lists the
conflicts and you resolve them per file (local / remote → Finalize merge).

## Per-machine settings

If you have keys in `~/.claude/settings.json` that are specific to this machine, put them in
**Settings → settings.local.json** (just the keys). They don't travel to the repo, and on scatter
they're layered over the shared base.

## Language

The UI ships in English and neutral Latin American Spanish. It defaults to the host locale; switch
it in **Settings → Language**. When testing UI changes, **verify both locales** — the toggle is live
(no restart), and the `<html lang>` attribute follows the selection.

---

## Downloadable binary (CI)

Pushing a `vX.Y.Z` tag triggers GitHub Actions (`.github/workflows/release.yml`), which builds the
`.dmg` (macOS) and `.AppImage` + `.deb` + `.pacman` (Linux) **unsigned** and publishes them to the
code repo's Release:

```bash
git tag v0.1.1
git push origin v0.1.1
```

On macOS, since builds are unsigned/ad-hoc, the first open goes through **System Settings → Privacy
& Security → "Open Anyway"** (on macOS 15+, the old right-click → Open was removed), or clear the
quarantine with `xattr -cr "/Applications/Claude Total Recall.app"`. See the README for the full flow.
