# build/ — packaging resources

electron-builder pulls its resources from here (`buildResources: build` in `electron-builder.yml`).

## Icon

1. Save the app artwork as **`build/icon-source.png`** (square PNG, ideally ≥1024×1024).
2. Run **`npm run icon`** → generates `build/icon.png` (1024×1024).
   - To crop the black margin: `CROP_PCT=90 npm run icon`.
3. Run **`npm run icons`** → generates the Linux set `build/icons/<N>x<N>.png` (16…512).
4. macOS: electron-builder builds the `.icns` from `build/icon.png` automatically.

**Linux needs the explicit `build/icons/` set** — do NOT rely on `build/icon.png` alone.
electron-builder does not resize a single Linux PNG: it installs `build/icon.png` at its
native 1024×1024 into `hicolor/1024x1024/apps`, a size the icon theme does not index, so
the launcher falls back to a generic icon (issue #19). `electron-builder.yml` points
`linux.icon` at `build/icons`, which installs each size into its `hicolor/<N>x<N>/apps` dir.

`icon-source.png`, `icon.png` and `icons/` are committed (the release CI only checks out —
it does not regenerate them, so no ImageMagick is needed at build time).

## DMG background (macOS installer)

The macOS `.dmg` shows a background behind the drag-to-Applications layout. It's
generated from a self-contained HTML source, so copy/design tweaks are one edit
away (no hand-painting pixels).

1. Edit the design/copy in **`scripts/background.html`** (inline CSS + SVG, no
   external assets). Coordinates are 1x (640×604); the two glows sit at the icon
   centers electron-builder uses — `(165,217)` app · `(475,217)` Applications alias.
   The blank canvas below the design is load-bearing, not spare margin — see below.
2. Run **`npm run background`** → renders via headless Chromium at 2x and downscales:
   - `build/background@2x.png` (1280×1208, retina — auto-picked by name)
   - `build/background.png` (640×604, 1x — referenced by `dmg.background`)

Cross-platform (Chromium + ImageMagick), unlike the `sips`-based icon script, so it
runs on Linux/CI too. Override the browser with `CHROME=/path/to/chrome npm run background`.

**Why 604, not 528** (#67, #70): `dmg-builder` (electron-builder's DMG target) ignores
`dmg.window` entirely whenever `dmg.background` is set — it measures the background
file with `sips` and uses that as the DMG window's total size, title bar included.
528 (#67) reserved just the ~28px title bar, but that's not the whole story: dmgbuild's
`.DS_Store` also tells Finder to hide the path bar and status bar for this window, and
on macOS 26.2 Finder shows them anyway whenever the user has those View-menu toggles on
globally — clipping the bottom of the design regardless of title-bar math (#70). On that
Finder version both bars render stacked at the bottom (not under the title bar), so 604
adds most of its extra headroom below the design, with just a small cushion up top.

Both PNGs are committed (the release CI uses them). Single-language: English only.
