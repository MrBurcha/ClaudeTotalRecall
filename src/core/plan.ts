import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { PlatformAdapter } from '../platform'
import { projectSlotLogicalPath, projectSlotPath, projectSlots, userLevelItems } from './resolve'
import { mergeForScatter, splitForGather } from './settingsMerge'
import type { Config, Plan, PlanAction, SettingsObject, Verb } from './types'

export interface SyncContext {
  adapter: PlatformAdapter
  config: Config
  machineId: string
  /** working copy del repo (clon local) */
  repoDir: string
  /** contenido de settings.local.json (overrides locales) */
  localOverrides: SettingsObject
}

const SETTINGS_LOGICAL = 'memories/user/settings.json'

// ── Guard anti-secretos (defensa en profundidad, §4/§18) ─────────────────────
/**
 * Nunca sincronizar credenciales, config durable con estado, ni transcripts,
 * AUNQUE un path esté mal configurado. El allowlist ya los excluye; esto es la
 * última red antes de que entren al Plan.
 */
export function isSecretExcluded(relPath: string): boolean {
  const base = posix.basename(relPath.split(/[\\/]/).join('/'))
  if (base === '.credentials.json') return true
  if (base === '.claude.json') return true
  if (base.endsWith('.jsonl')) return true
  return false
}

// ── helpers de fs / hashing ──────────────────────────────────────────────────
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

async function hashFile(p: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(p))
    .digest('hex')
}

/** Lista archivos (recursivo) relativos a `dir`, filtrando secretos. Vacío si no existe. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(cur: string, rel: string): Promise<void> {
    let entries
    try {
      entries = await readdir(cur, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const childRel = rel ? posix.join(rel, e.name) : e.name
      if (e.isDirectory()) {
        await walk(join(cur, e.name), childRel)
      } else if (e.isFile() && !isSecretExcluded(childRel)) {
        out.push(childRel)
      }
    }
  }
  await walk(dir, '')
  return out.sort()
}

// ── settings.json (contenido computado) ──────────────────────────────────────
interface SettingsWrite {
  from: string
  to: string
  content: string
}

/**
 * Calcula el contenido de settings.json a escribir (o null si no hay nada que
 * hacer). Deterministic desde disco + overrides, así el executor puede recomputar.
 */
async function settingsWrite(ctx: SyncContext, verb: Verb): Promise<SettingsWrite | null> {
  const realPath = join(ctx.adapter.claudeHome(), 'settings.json')
  const sharedPath = join(ctx.repoDir, SETTINGS_LOGICAL)

  if (verb === 'gather') {
    if (!(await pathExists(realPath))) return null
    const real = JSON.parse(await readFile(realPath, 'utf8')) as SettingsObject
    const shared = splitForGather(real, ctx.localOverrides)
    return { from: realPath, to: sharedPath, content: JSON.stringify(shared, null, 2) + '\n' }
  }
  // scatter
  if (!(await pathExists(sharedPath))) return null
  const shared = JSON.parse(await readFile(sharedPath, 'utf8')) as SettingsObject
  const merged = mergeForScatter(shared, ctx.localOverrides)
  return { from: sharedPath, to: realPath, content: JSON.stringify(merged, null, 2) + '\n' }
}

async function settingsAction(ctx: SyncContext, verb: Verb): Promise<PlanAction> {
  const w = await settingsWrite(ctx, verb)
  if (!w) {
    return {
      slot: 'user:settings.json',
      logicalPath: SETTINGS_LOGICAL,
      from: null,
      to: null,
      type: 'skip',
      reason: verb === 'gather' ? 'no hay ~/.claude/settings.json local' : 'no hay settings.json en el repo',
    }
  }
  const hashFrom = hashString(w.content)
  const hashTo = (await pathExists(w.to)) ? await hashFile(w.to) : undefined
  const type = hashTo === undefined ? 'create' : hashFrom === hashTo ? 'noop' : 'overwrite'
  return {
    slot: 'user:settings.json',
    logicalPath: SETTINGS_LOGICAL,
    from: w.from,
    to: w.to,
    type,
    hashFrom,
    hashTo,
    transform: verb === 'gather' ? 'settings-gather' : 'settings-scatter',
  }
}

// ── sync de un directorio (mirror con delete) ────────────────────────────────
async function planDirSync(
  slotBase: string,
  srcDir: string,
  destDir: string,
  logicalPrefix: string,
): Promise<PlanAction[]> {
  const srcFiles = new Set(await listFiles(srcDir))
  const destFiles = new Set(await listFiles(destDir))
  const all = [...new Set([...srcFiles, ...destFiles])].sort()
  const actions: PlanAction[] = []
  for (const rel of all) {
    const from = join(srcDir, rel)
    const to = join(destDir, rel)
    const logicalPath = posix.join(logicalPrefix, rel)
    const slot = `${slotBase}/${rel}`
    if (srcFiles.has(rel) && !destFiles.has(rel)) {
      actions.push({ slot, logicalPath, from, to, type: 'create', hashFrom: await hashFile(from) })
    } else if (srcFiles.has(rel) && destFiles.has(rel)) {
      const hashFrom = await hashFile(from)
      const hashTo = await hashFile(to)
      actions.push({
        slot,
        logicalPath,
        from,
        to,
        type: hashFrom === hashTo ? 'noop' : 'overwrite',
        hashFrom,
        hashTo,
      })
    } else {
      actions.push({
        slot,
        logicalPath,
        from: null,
        to,
        type: 'delete',
        hashTo: await hashFile(to),
        reason: 'no existe en el origen',
      })
    }
  }
  return actions
}

async function planFileSync(
  slot: string,
  srcFile: string,
  destFile: string,
  logicalPath: string,
): Promise<PlanAction> {
  const srcExists = await pathExists(srcFile)
  const destExists = await pathExists(destFile)
  if (!srcExists) {
    return { slot, logicalPath, from: null, to: destFile, type: 'skip', reason: 'el origen no existe' }
  }
  const hashFrom = await hashFile(srcFile)
  if (!destExists) {
    return { slot, logicalPath, from: srcFile, to: destFile, type: 'create', hashFrom }
  }
  const hashTo = await hashFile(destFile)
  return {
    slot,
    logicalPath,
    from: srcFile,
    to: destFile,
    type: hashFrom === hashTo ? 'noop' : 'overwrite',
    hashFrom,
    hashTo,
  }
}

// ── construcción del Plan ────────────────────────────────────────────────────
export async function buildPlan(
  ctx: SyncContext,
  verb: Verb,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  const actions: PlanAction[] = []

  // user-level: CLAUDE.md (file), commands/agents/skills (dir), settings.json (special)
  for (const item of userLevelItems(ctx.adapter)) {
    if (item.slot === 'settings.json') continue // manejado aparte
    const repoPath = join(ctx.repoDir, item.logicalPath)
    const [src, dest] =
      verb === 'gather' ? [item.realPath, repoPath] : [repoPath, item.realPath]
    if (item.kind === 'file') {
      actions.push(await planFileSync(`user:${item.slot}`, src, dest, item.logicalPath))
    } else {
      actions.push(...(await planDirSync(`user:${item.slot}`, src, dest, item.logicalPath)))
    }
  }

  // settings.json (compartido + overrides locales)
  actions.push(await settingsAction(ctx, verb))

  // proyectos: cada ranura, saltando las que no tienen path para esta máquina
  for (const projectName of Object.keys(ctx.config.projects)) {
    for (const slot of projectSlots(ctx.config, projectName)) {
      const machinePath = projectSlotPath(ctx.config, projectName, slot, ctx.machineId)
      const logicalPrefix = projectSlotLogicalPath(projectName, slot)
      const repoPath = join(ctx.repoDir, logicalPrefix)
      const slotBase = `project:${projectName}/${slot}`
      if (!machinePath) {
        actions.push({
          slot: slotBase,
          logicalPath: logicalPrefix,
          from: null,
          to: null,
          type: 'skip',
          reason: `sin path para la máquina "${ctx.machineId}"`,
        })
        continue
      }
      const [src, dest] = verb === 'gather' ? [machinePath, repoPath] : [repoPath, machinePath]
      actions.push(...(await planDirSync(slotBase, src, dest, logicalPrefix)))
    }
  }

  return { id: meta.id, verb, createdAt: meta.createdAt, actions }
}

// ── ejecución del Plan (con revalidación TOCTOU) ─────────────────────────────
export class PlanDriftError extends Error {
  constructor(readonly drifted: PlanAction[]) {
    super(
      `El disco cambió desde que se armó el Plan (${drifted.length} acción/es con drift). ` +
        `Reconstruí el Plan antes de ejecutar.`,
    )
    this.name = 'PlanDriftError'
  }
}

export interface ExecResult {
  applied: number
  created: number
  overwritten: number
  deleted: number
  skipped: number
}

/** Recalcula el hash del contenido que la acción escribiría, para revalidar. */
async function currentSourceHash(action: PlanAction, ctx: SyncContext): Promise<string | null> {
  if (action.transform) {
    const w = await settingsWrite(ctx, action.transform === 'settings-gather' ? 'gather' : 'scatter')
    return w ? hashString(w.content) : null
  }
  if (!action.from) return null
  if (!(await pathExists(action.from))) return null
  return hashFile(action.from)
}

export async function executePlan(
  plan: Plan,
  ctx: SyncContext,
  opts: { force?: boolean } = {},
): Promise<ExecResult> {
  // 1) Revalidación TOCTOU: el origen no debe haber cambiado desde el build.
  if (!opts.force) {
    const drifted: PlanAction[] = []
    for (const a of plan.actions) {
      if (a.type === 'create' || a.type === 'overwrite') {
        const now = await currentSourceHash(a, ctx)
        if (now !== (a.hashFrom ?? null)) drifted.push(a)
      }
    }
    if (drifted.length > 0) throw new PlanDriftError(drifted)
  }

  // 2) Aplicar.
  const res: ExecResult = { applied: 0, created: 0, overwritten: 0, deleted: 0, skipped: 0 }
  for (const a of plan.actions) {
    if (a.type === 'noop' || a.type === 'skip') {
      res.skipped++
      continue
    }
    if (a.type === 'delete') {
      if (a.to) await rm(a.to, { force: true })
      res.deleted++
      res.applied++
      continue
    }
    // create | overwrite
    if (!a.to) continue
    await mkdir(dirname(a.to), { recursive: true })
    if (a.transform) {
      const w = await settingsWrite(ctx, a.transform === 'settings-gather' ? 'gather' : 'scatter')
      if (w) await writeFile(a.to, w.content)
    } else if (a.from) {
      await copyFile(a.from, a.to)
    }
    if (a.type === 'create') res.created++
    else res.overwritten++
    res.applied++
  }
  return res
}
