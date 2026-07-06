# Probar ClaudeTR dogfoodeando (sincronizar la memoria de este mismo proyecto)

> `ClaudeTotalRecall` es el **código** de la app. El **destino de las memorias** es un repo
> **separado, privado y vacío**. No sincronices memorias dentro del repo de código.

## 0. Requisitos

`git`, `gh` autenticado (`gh auth status`), `npm install` corrido. Verificá con:

```bash
npm run cli:check      # git ✓ / gh ✓ / gh-auth ✓
```

## 1. Crear el repo de memorias (vacío, privado)

```bash
gh repo create MrBurcha/claude-memories --private
```

No hace falta inicializarlo con nada: ClaudeTR crea la estructura en el primer connect.

## 2. Levantar la app

En WebStorm: run configuration **dev**. O por terminal:

```bash
npm run dev
```

## 3. Conectar el repo (Ajustes)

Pantalla **Ajustes → Repo** → pegar `https://github.com/MrBurcha/claude-memories.git` →
**Conectar**. La app clona, crea `claudetr.json` + `memories/…` y hace el primer push.

## 4. Registrar esta máquina (Máquinas)

**Máquinas → Registrar esta máquina** → nombre lógico, p.ej. `mac-studio`.

## 5. Sumar el proyecto ClaudeTR (Proyectos)

**Proyectos → Sumar proyecto/ranura**:
- Nombre lógico: `claudetr`
- Ranura: `memory`
- **Elegir carpeta…** → navegá a:
  `~/.claude/projects/-Users-tu-usuario-Projects-ClaudeTR/memory`

Se guarda el path **literal** de esta máquina.

## 6. Gather (Dashboard)

**Dashboard → Gather** → revisá el **preview del Plan** (create/overwrite/noop/skip) →
**Confirmar**. Sube:
- memoria user-level: `~/.claude/CLAUDE.md`, `commands/`, `agents/`, `skills/`, `settings.json` (saneado)
- memoria del proyecto `claudetr`

El **guard** excluye siempre `.credentials.json`, `*.jsonl` y `.claude.json`.

## 7. Verificar en GitHub

Abrí `github.com/MrBurcha/claude-memories` y confirmá:
- `claudetr.json` con tu máquina y el proyecto `claudetr`
- `memories/user/…` y `memories/projects/claudetr/memory/…`
- **no** hay credenciales ni transcripts

## 8. Round-trip (opcional, con otra máquina)

En la otra máquina: **Ajustes → Conectar** el mismo repo → **Máquinas → Registrar** (otro nombre)
→ **Proyectos → Sumar** `claudetr/memory` con **su** path local → **Dashboard → Scatter** →
la memoria baja a esa máquina. Si editaste la misma memoria de los dos lados, la app lista los
conflictos y los resolvés por-archivo (local / remoto → Finalizar merge).

## Settings por máquina

Si tenés claves en `~/.claude/settings.json` que son propias de esta máquina, ponelas en
**Ajustes → settings.local.json** (solo las claves). No viajan al repo, y al hacer scatter se
enciman sobre la base compartida.

---

## Binario descargable (CI)

Al pushear un tag `vX.Y.Z`, GitHub Actions (`.github/workflows/release.yml`) buildea el `.dmg`
(macOS) y `.AppImage` + `.deb` + `.pacman` (Linux) **sin firmar** y los publica en el Release del
repo de código:

```bash
git tag v0.1.0
git push origin v0.1.0
```

En macOS, al ser sin firmar, la primera vez se abre con **click derecho → Abrir**.
