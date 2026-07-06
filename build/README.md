# build/ — recursos de empaquetado

electron-builder toma los recursos de acá (`buildResources: build` en `electron-builder.yml`).

## Ícono

1. Guardá el arte de la app como **`build/icon-source.png`** (PNG cuadrado, idealmente ≥1024×1024).
2. Corré **`npm run icon`** → genera `build/icon.png` (1024×1024).
   - Para recortar el margen negro: `CROP_PCT=90 npm run icon`.
3. electron-builder genera el `.icns` (macOS) y usa el `.png` (Linux) automáticamente.

`icon-source.png` y `icon.png` se commitean (los usa el CI de release).
