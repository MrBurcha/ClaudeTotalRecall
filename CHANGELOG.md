# Changelog

Todos los cambios notables de ClaudeTR se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

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

[0.1.2]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.2
[0.1.1]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.1
[0.1.0]: https://github.com/MrBurcha/ClaudeTotalRecall/releases/tag/v0.1.0
