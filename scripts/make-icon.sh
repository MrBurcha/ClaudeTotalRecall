#!/usr/bin/env bash
# Genera build/icon.png (1024x1024) a partir de build/icon-source.png.
# electron-builder toma ese PNG y genera el .icns (macOS) y usa el PNG (Linux).
#
# Uso:
#   1) Guardá el arte como build/icon-source.png (cuadrado, idealmente >=1024).
#   2) npm run icon        (o: bash scripts/make-icon.sh)
#
# Recorte opcional del margen: CROP_PCT=90 npm run icon  (recorta centrado al 90%).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/build/icon-source.png"
OUT="$ROOT/build/icon.png"
CROP_PCT="${CROP_PCT:-100}"

if [ ! -f "$SRC" ]; then
  echo "✗ Falta $SRC — guardá tu arte ahí (PNG cuadrado) y reintentá." >&2
  exit 1
fi

TMP="$SRC"
if [ "$CROP_PCT" != "100" ]; then
  W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
  SIDE=$(( W * CROP_PCT / 100 ))
  TMP="$ROOT/build/.icon-cropped.png"
  sips -c "$SIDE" "$SIDE" "$SRC" --out "$TMP" >/dev/null
fi

sips -z 1024 1024 "$TMP" --out "$OUT" >/dev/null
[ "$TMP" != "$SRC" ] && rm -f "$TMP"
echo "✓ Generado $OUT (1024x1024). electron-builder lo usa para macOS y Linux."
