import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Config que vive en el repo (claudetr.json). Ver §7/§8 del plan.
// ─────────────────────────────────────────────────────────────────────────────

export const OsSchema = z.enum(['linux', 'macos']) // 'windows' se suma después
export type Os = z.infer<typeof OsSchema>

export const MachineSchema = z.object({
  os: OsSchema,
  hostname: z.string().min(1),
  home: z.string().min(1),
})
export type Machine = z.infer<typeof MachineSchema>

/**
 * Un proyecto lógico. `folders` es un mapa de ranuras lógicas (default "memory")
 * y cada ranura mapea machineId → path absoluto literal en esa máquina.
 */
export const ProjectSchema = z.object({
  folders: z.record(z.string(), z.record(z.string(), z.string())),
})
export type Project = z.infer<typeof ProjectSchema>

export const ConfigSchema = z.object({
  version: z.literal(1),
  repo: z.object({
    // git acepta HTTPS, SSH (git@…) y file://; no forzamos formato de URL.
    remote: z.string().min(1),
  }),
  machines: z.record(z.string(), MachineSchema),
  projects: z.record(z.string(), ProjectSchema),
})
export type Config = z.infer<typeof ConfigSchema>

export function emptyConfig(remote: string): Config {
  return { version: 1, repo: { remote }, machines: {}, projects: {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado local (fuera del repo, en ~/.config/claudetr/).
// ─────────────────────────────────────────────────────────────────────────────

export const LocalStateSchema = z.object({
  machineId: z.string().min(1),
})
export type LocalState = z.infer<typeof LocalStateSchema>

/** settings.json es un objeto JSON arbitrario; el merge es shallow por top-level key. */
export type SettingsObject = Record<string, unknown>

// ─────────────────────────────────────────────────────────────────────────────
// Plan (dry-run obligatorio). Ver §10.
// ─────────────────────────────────────────────────────────────────────────────

export type Verb = 'gather' | 'scatter'

export type PlanActionType =
  | 'create' // el destino no existe
  | 'overwrite' // el destino existe y cambia (hash distinto)
  | 'delete' // el destino existe y sobra
  | 'noop' // origen y destino idénticos (mismo hash)
  | 'skip' // ranura sin path para esta máquina, o excluida por guard

export interface PlanAction {
  /** id legible de la ranura/archivo, p.ej. "user:CLAUDE.md" o "project:demo-core/memory/foo.md" */
  slot: string
  /** path lógico dentro del repo (relativo a la raíz del working copy) */
  logicalPath: string
  /** path absoluto origen (null si no aplica) */
  from: string | null
  /** path absoluto destino (null si no aplica) */
  to: string | null
  type: PlanActionType
  hashFrom?: string
  hashTo?: string
  /** motivo humano, sobre todo para skip/delete */
  reason?: string
  /**
   * Marca acciones cuyo contenido NO es una copia directa sino un cómputo
   * (el merge/split de settings.json, §6). El executor recomputa el contenido
   * en vez de copiar el archivo.
   */
  transform?: 'settings-gather' | 'settings-scatter'
}

export interface Plan {
  id: string
  verb: Verb
  /** ISO timestamp; lo estampa quien construye el Plan (inyectado, no Date.now interno) */
  createdAt: string
  actions: PlanAction[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del repo y preflight.
// ─────────────────────────────────────────────────────────────────────────────

export interface RepoStatus {
  branch: string
  ahead: number
  behind: number
  dirty: boolean
  conflicted: string[]
}

export interface PreflightCheck {
  name: 'git' | 'gh' | 'gh-auth'
  ok: boolean
  detail?: string
  /** sugerencia accionable si !ok (comando o link) */
  fix?: string
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}
