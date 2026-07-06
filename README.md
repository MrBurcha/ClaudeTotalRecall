# ClaudeTR · Claude Total Recall

App de escritorio (Electron + TypeScript) para sincronizar la **memoria de Claude Code**
(`~/.claude/…`) entre varias máquinas, contra un **repo GitHub privado**, usando `git`/`gh`
como transporte. macOS y Linux; Windows queda aislado para sumarlo después.

## Cómo funciona (resumen)

- La **memoria** (CLAUDE.md user-level, `commands/`/`agents/`/`skills/`, `settings.json`, y las
  carpetas de memoria por proyecto declaradas a mano) se copia hacia/desde un **working copy**
  del repo bajo nombres lógicos.
- Todo verbo mutante arma primero un **Plan (dry-run)** que se previsualiza antes de tocar disco.
- **Conflictos por merge**: `ours` = local, `theirs` = remoto; se resuelven por-archivo.
- **Nunca** viajan secretos: guard que excluye `.credentials.json`, `*.jsonl`, `.claude.json`.
- `settings.json` = base compartida + `settings.local.json` con overrides por clave (local gana).

## Requisitos

`git`, `gh` (GitHub CLI) autenticado (`gh auth login && gh auth setup-git`). El comando
`claudetr check` (o la pantalla de Ajustes) verifica todo.

## Desarrollo

```bash
npm install
npm run dev          # app Electron en modo dev
npm test             # suite vitest (core + git + orquestación)
npm run typecheck    # tsc --noEmit
```

## CLI headless (mismo core que la UI)

```bash
npm run build:cli
node dist-cli/index.js check
node dist-cli/index.js connect <remote-url>
node dist-cli/index.js register --name <id-logico>
node dist-cli/index.js gather  [--dry-run] [--yes]
node dist-cli/index.js scatter [--dry-run] [--yes]
```

## Empaquetado (firma ad-hoc, uso personal)

```bash
npm run build:mac    # release/ClaudeTR-<v>-arm64.dmg   (verificado)
npm run build:linux  # AppImage + deb + pacman  (correr en Linux o CI, no cross desde macOS)
```

### macOS: instalar y abrir

Los builds son **ad-hoc** (sin certificado Developer ID ni notarización de Apple).
La firma ad-hoc (ver `scripts/afterPack.cjs`) sella los recursos del bundle para que
macOS **no** lo marque como *"dañado"* en Apple Silicon. Como no está notarizado, al
bajar el `.dmg` de un GitHub Release (que le pega el atributo de cuarentena) la primera
apertura pide un OK manual. En **macOS 15 (Sequoia) y posteriores** el viejo *"click
derecho → Abrir"* fue **eliminado**; el flujo vigente es:

1. Doble clic → aparece *"Apple no pudo verificar…"* → **Listo**.
2. **Ajustes del Sistema → Privacidad y Seguridad**, bajá hasta la sección **Seguridad**:
   vas a ver *"Se bloqueó el uso de ClaudeTR…"* → **Abrir igualmente**.
3. Confirmá con Touch ID / contraseña → **Abrir**. Es un paso único; después abre siempre.

Atajo equivalente por terminal (saca la cuarentena de una):

```bash
xattr -cr /Applications/ClaudeTR.app
```

> Para que abra **sin ningún diálogo** ("de una", como las apps del App Store) hace falta
> **notarización** con una cuenta Apple Developer (paga); la firma ad-hoc no alcanza.

## Layout

- `src/core/` — lógica pura (config, plan, gather/scatter, git, service, preflight). Sin Electron.
- `src/platform/` — único código OS-específico (adapter linux/macos).
- `src/cli/` — entrypoint headless.
- `src/main/` — bootstrap Electron + IPC + preload.
- `src/renderer/` — UI React.

## Pendiente / follow-ups

- Validar el ciclo completo contra un repo **GitHub privado real** (los tests usan remotes
  `file://` locales, mecánica idéntica).
- Buildear los artefactos **Linux** en una máquina Linux o CI.
- v1.1+: discover automático de proyectos, editor de merge 3-way in-app, timestamps por proyecto,
  crear repo desde la app, Windows.
