#!/usr/bin/env bash
# Generates the macOS DMG installer background from scripts/background.html:
#   build/background@2x.png (1280x1056, retina) + build/background.png (640x528).
# electron-builder's `dmg.background` points at build/background.png and auto-picks
# the @2x variant by name. dmg-builder derives the DMG window's total size directly
# from this file's pixel dimensions (see the comment in background.html) — 528, not
# 500, so the ~28px title bar doesn't clip the bottom of the design.
#
# Usage:
#   npm run background        (or: bash scripts/make-background.sh)
#
# Edit the copy/design in scripts/background.html and re-run. Cross-platform
# (Chromium + ImageMagick), unlike the sips-based make-icon.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$ROOT/scripts/background.html"
OUT2X="$ROOT/build/background@2x.png"
OUT1X="$ROOT/build/background.png"

[ -f "$HTML" ] || { echo "✗ Missing $HTML" >&2; exit 1; }

# Locate a Chromium/Chrome binary (override with CHROME=/path/to/chrome).
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
  done
fi
[ -n "$CHROME" ] || { echo "✗ No chromium/chrome found. Set CHROME=/path/to/chrome." >&2; exit 1; }

PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

# Render at 2x: window 640x528 × device-scale-factor 2 = 1280x1056 screenshot.
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=640,528 \
  --user-data-dir="$PROFILE" \
  --screenshot="$OUT2X" "file://$HTML" >/dev/null 2>&1 || true

[ -s "$OUT2X" ] || { echo "✗ Chromium did not produce $OUT2X (try CHROME=... or --headless)." >&2; exit 1; }

# Downscale the retina render to the 1x asset.
if command -v magick >/dev/null 2>&1; then
  magick "$OUT2X" -resize 640x528 "$OUT1X"
else
  convert "$OUT2X" -resize 640x528 "$OUT1X"
fi

dims() { identify -format '%wx%h' "$1" 2>/dev/null || echo '?'; }
echo "✓ Generated build/background@2x.png ($(dims "$OUT2X")) + build/background.png ($(dims "$OUT1X"))."
echo "  electron-builder uses these for the macOS DMG background."
