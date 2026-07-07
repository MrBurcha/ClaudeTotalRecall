#!/usr/bin/env bash
# Generates the Linux icon set build/icons/<N>x<N>.png from build/icon.png.
#
# Why this exists: electron-builder does NOT auto-generate a multi-size PNG set
# for Linux from a single icon.png — it installs that one PNG at its native size
# (1024x1024), which is NOT a size the hicolor icon theme indexes, so GNOME shows
# a generic launcher icon. Providing build/icons/ with standard sizes (pointed at
# by `linux.icon`) makes electron-builder install each into hicolor/<N>x<N>/apps/.
#
# Usage:
#   npm run icons        (or: bash scripts/make-icons.sh)
#
# Regenerate whenever build/icon.png changes. Cross-platform (ImageMagick), like
# make-background.sh — unlike the sips-based make-icon.sh which is macOS-only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/build/icon.png"
OUT="$ROOT/build/icons"

# Standard hicolor sizes the icon theme indexes (16..512). 256 and 512 are the
# ones the app grid / launcher actually renders; the rest keep menus crisp.
SIZES=(16 24 32 48 64 128 256 512)

[ -f "$SRC" ] || { echo "✗ Missing $SRC — run 'npm run icon' first (or add the art)." >&2; exit 1; }

# electron-builder maps each PNG to hicolor/<actualWxH>/apps, so the pixels must
# match the filename exactly. '!' forces the exact size (source is square anyway).
resize() {
  if command -v magick >/dev/null 2>&1; then
    magick "$SRC" -resize "${1}x${1}!" "$OUT/${1}x${1}.png"
  else
    convert "$SRC" -resize "${1}x${1}!" "$OUT/${1}x${1}.png"
  fi
}

mkdir -p "$OUT"
for s in "${SIZES[@]}"; do
  resize "$s"
done

echo "✓ Generated ${#SIZES[@]} icons in build/icons/ (${SIZES[*]}px)."
echo "  electron-builder installs each into /usr/share/icons/hicolor/<N>x<N>/apps/."
