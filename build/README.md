# build/ — packaging resources

electron-builder pulls its resources from here (`buildResources: build` in `electron-builder.yml`).

## Icon

1. Save the app artwork as **`build/icon-source.png`** (square PNG, ideally ≥1024×1024).
2. Run **`npm run icon`** → generates `build/icon.png` (1024×1024).
   - To crop the black margin: `CROP_PCT=90 npm run icon`.
3. electron-builder generates the `.icns` (macOS) and uses the `.png` (Linux) automatically.

`icon-source.png` and `icon.png` are committed (the release CI uses them).

## DMG background (macOS installer)

The macOS `.dmg` shows a background behind the drag-to-Applications layout. It's
generated from a self-contained HTML source, so copy/design tweaks are one edit
away (no hand-painting pixels).

1. Edit the design/copy in **`scripts/background.html`** (inline CSS + SVG, no
   external assets). Coordinates are 1x (640×500); the two glows sit at the icon
   centers electron-builder uses — `(165,195)` app · `(475,195)` Applications alias.
2. Run **`npm run background`** → renders via headless Chromium at 2x and downscales:
   - `build/background@2x.png` (1280×1000, retina — auto-picked by name)
   - `build/background.png` (640×500, 1x — referenced by `dmg.background`)

Cross-platform (Chromium + ImageMagick), unlike the `sips`-based icon script, so it
runs on Linux/CI too. Override the browser with `CHROME=/path/to/chrome npm run background`.

Both PNGs are committed (the release CI uses them). Single-language: English only.
