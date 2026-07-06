# Changelog

Todos los cambios notables de ClaudeTR se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

## [0.1.4] - 2026-07-06

### Arreglado
- **El fondo del DMG no se veía en macOS 26.2.** No era un problema del arte ni de la config:
  macOS 26.2 dejó de resolver el registro `pBBk` (background *bookmark*) que `dmgbuild` escribía
  en el `.DS_Store`, dejando el DMG sin fondo (afecta a todos los instaladores, no solo a este —
  ver electron-builder #9072). Se parchea `dmgbuild` (vía `patch-package`) para no escribir ese
  bookmark; queda el `backgroundImageAlias`, que macOS 26.2 sí resuelve. El volumen ahora monta
  con nombre versionado ("ClaudeTR x.y.z") para que Finder lea siempre el `.DS_Store` fresco.

## [0.1.3] - 2026-07-06

### Agregado
- **DMG con fondo de instalación.** Al abrir la imagen se ve una ventana guiada: el arrastre
  de **ClaudeTR → Aplicaciones** con una flecha, y una tarjeta con las **dos formas de abrir**
  la app en macOS (Ajustes → Privacidad y Seguridad → "Abrir igualmente", o `xattr -cr`). Sigue
  la identidad visual "Estación de sincronización" (dark, periwinkle, constelación).

## [0.1.2] - 2026-07-06

### Arreglado
- **macOS: el `.dmg` ya no abre como "aplicación dañada" en Apple Silicon.** El bundle
  se generaba sin pasar por `codesign` (`identity: null`), así que solo tenía la firma
  linker-signed del ejecutable, sin recursos sellados; con la cuarentena que macOS le pega
  a las descargas, Gatekeeper lo interpretaba como manipulado. Ahora un hook `afterPack`
  (`scripts/afterPack.cjs`) firma el bundle **ad-hoc** (`codesign --force --deep --sign -`)
  antes de armar el `.dmg`, sellando los recursos y eliminando el veredicto "dañado".

### Notas
- Los builds siguen **sin notarizar** (uso personal, sin cuenta Apple Developer). En una
  descarga nueva aparece el aviso "Apple no pudo verificar…". En **macOS 15+** el viejo
  *click derecho → Abrir* fue eliminado; abrí desde **Ajustes del Sistema → Privacidad y
  Seguridad → "Abrir igualmente"** (paso único), o sacá la cuarentena con
  `xattr -cr /Applications/ClaudeTR.app`. Para cero diálogos hace falta notarización (paga).

## [0.1.1] - 2026-07-05

### Agregado
- Barra de título propia (ventana frameless): saca el menú nativo y arregla el ícono en Linux.
- Sincronización automática con motor de baseline, sync con un botón y panel **Avanzado**.
- Rediseño **"Estación de sincronización"** del renderer (identidad visual dark/constelación).

### Cambiado
- Crear un proyecto ya existente es idempotente y guía a su tarjeta.

## [0.1.0] - 2026-07-05

### Agregado
- Primer release de ClaudeTR (Claude Total Recall): app Electron + CLI headless para
  sincronizar la memoria de Claude Code (`~/.claude/…`) entre máquinas vía repo GitHub
  privado, con `git`/`gh` como transporte.
- Verbos `gather`/`scatter` con Plan (dry-run) previo, guard de secretos, y merge de
  `settings.json` (base compartida + overrides locales).
- Empaquetado macOS (`.dmg`) y Linux (AppImage + deb + pacman), publicado por CI al pushear
  un tag `v*.*.*`.

[0.1.4]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.4
[0.1.3]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.3
[0.1.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.2
[0.1.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.1
[0.1.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.0
