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
   external assets). Coordinates are 1x (640×528); the two glows sit at the icon
   centers electron-builder uses — `(165,195)` app · `(475,195)` Applications alias.
   The visible design occupies the top ~472px; the remaining ~28px of blank canvas
   at the bottom are load-bearing, not spare margin — see below.
2. Run **`npm run background`** → renders via headless Chromium at 2x and downscales:
   - `build/background@2x.png` (1280×1056, retina — auto-picked by name)
   - `build/background.png` (640×528, 1x — referenced by `dmg.background`)

Cross-platform (Chromium + ImageMagick), unlike the `sips`-based icon script, so it
runs on Linux/CI too. Override the browser with `CHROME=/path/to/chrome npm run background`.

**Why 528, not 500** (#67): `dmg-builder` (electron-builder's DMG target) ignores
`dmg.window` entirely whenever `dmg.background` is set — it measures the background
file with `sips` and uses that as the DMG window's total size, title bar included.
A 640×500 background under a ~28px title bar clips the bottom of the design; 528
reserves exactly that title-bar height so the full design shows without resizing.

Both PNGs are committed (the release CI uses them). Single-language: English only.
