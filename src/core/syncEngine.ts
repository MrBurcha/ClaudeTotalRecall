import { randomUUID } from 'node:crypto'
import type { PlatformAdapter } from '../platform'
import { Git } from './git'
import { loadBaseline, saveBaseline } from './localState'
import { PlanDriftError } from './plan'
import { buildVerbPlan, pullRepo, syncGather, syncScatter, workingCopyDir } from './service'
import type { Plan, PlanAction } from './types'

/**
 * Resultado de un ciclo de auto-sync.
 * - `synced`: quedó todo al día (con detalle de qué se movió).
 * - `conflict`: hay un conflicto de merge (git) por resolver a mano ⇒ el scheduler
 *   se pausa y la UI se pone roja.
 * - `error`: fallo de red/git ⇒ el scheduler decide backoff y reintenta.
 */
export type SyncOutcome =
  | { kind: 'synced'; pushed: boolean; pulled: boolean; scattered: boolean }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'error'; message: string }

function newMeta(): { id: string; createdAt: string } {
  return { id: randomUUID(), createdAt: new Date().toISOString() }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Filtra un Plan a las acciones "seguras" para auto-sync (modo aditivo + baseline):
 * `create`/`overwrite` siempre (nunca destruyen datos), y `delete` SÓLO si el path
 * estaba en el baseline — es decir, es una baja real de un archivo que ya estaba
 * sincronizado, y no un archivo que la contraparte todavía no vio. `noop`/`skip`
 * se descartan. Así una máquina recién conectada nunca vuela el repo y los borrados
 * locales se propagan sin resurrección. Ver la doc de `runSyncCycle`.
 */
function safeActions(plan: Plan, baseline: Set<string>): PlanAction[] {
  return plan.actions.filter((a) => {
    if (a.type === 'create' || a.type === 'overwrite') return true
    if (a.type === 'delete') return baseline.has(a.logicalPath)
    return false
  })
}

/**
 * Conjunto de logicalPaths presentes en el working copy, leído de un plan de
 * scatter (donde `from` = working copy). Es el nuevo baseline al cerrar el ciclo.
 */
function workingCopySnapshot(scatterPlan: Plan): Set<string> {
  const paths = new Set<string>()
  for (const a of scatterPlan.actions) {
    if (a.from !== null && a.type !== 'skip') paths.add(a.logicalPath)
  }
  return paths
}

async function attemptCycle(adapter: PlatformAdapter): Promise<SyncOutcome> {
  const git = new Git(workingCopyDir(adapter))
  const baseline = await loadBaseline(adapter)
  let pushed = false
  let pulled = false

  // ── Fase 1: subir (máquina → working copy), con borrados vetados por baseline ──
  const gatherPlan = await buildVerbPlan(adapter, 'gather', newMeta())
  const up = safeActions(gatherPlan, baseline)
  if (up.length > 0) {
    const r = await syncGather(adapter, { ...gatherPlan, actions: up })
    if (r.conflicts.length > 0) return { kind: 'conflict', files: r.conflicts }
    // Commiteamos pero el push no entró (red caída o rechazo persistente): no es
    // "al día" — el commit local quedó sin llegar al remoto. Salimos como error
    // para reintentar en el próximo ciclo (sin tocar baseline ni scattear).
    if (r.committed && !r.pushed) {
      return { kind: 'error', message: 'No se pudo pushear el commit al remoto' }
    }
    pushed = r.pushed
    pulled = true // syncGather pullea (merge del remoto) tras commitear
  } else {
    // Nada para subir por cambios locales: sincronizar con el remoto igual.
    await git.fetch()
    let st = await git.status()
    if (st.behind > 0) {
      const p = await pullRepo(adapter)
      if (p.conflicts.length > 0) return { kind: 'conflict', files: p.conflicts }
      pulled = true
      st = await git.status()
    }
    // Commits locales sin pushear (p.ej. un push que falló en un ciclo previo):
    // reintentar acá para no quedar "al día" con algo que no llegó al remoto.
    if (st.ahead > 0) {
      const push = await git.push()
      if (!push.ok) return { kind: 'error', message: 'No se pudo pushear al remoto' }
      pushed = true
    }
  }

  // ── Fase 2: bajar a la máquina (working copy → máquina), mismos vetos ──────────
  const scatterPlan = await buildVerbPlan(adapter, 'scatter', newMeta())
  const down = safeActions(scatterPlan, baseline)
  let scattered = false
  if (down.length > 0) {
    await syncScatter(adapter, { ...scatterPlan, actions: down })
    scattered = true
  }

  // ── Fase 3: baseline := estado sincronizado del working copy (post-pull) ───────
  await saveBaseline(adapter, workingCopySnapshot(scatterPlan))

  return { kind: 'synced', pushed, pulled, scattered }
}

/**
 * Corre un ciclo completo de auto-sync. Orquesta las primitivas de `service.ts`
 * en modo 3-vías con baseline: sube los cambios locales (mergeando el remoto vía
 * `syncGather`), baja lo que trajo el merge, y actualiza el baseline. Los conflictos
 * de contenido entre máquinas los detecta el `pull` de git y se devuelven como
 * `conflict`. Nunca tira: los fallos de red/git salen como `error`, y un
 * `PlanDriftError` (el disco cambió entre armar y ejecutar el Plan) reintenta una
 * vez con un plan fresco.
 */
export async function runSyncCycle(adapter: PlatformAdapter): Promise<SyncOutcome> {
  try {
    return await attemptCycle(adapter)
  } catch (err) {
    if (err instanceof PlanDriftError) {
      try {
        return await attemptCycle(adapter)
      } catch (err2) {
        return { kind: 'error', message: errorMessage(err2) }
      }
    }
    return { kind: 'error', message: errorMessage(err) }
  }
}

/**
 * Tras resolver un conflicto (el working copy ya tiene el merge finalizado y
 * pusheado por `completeConflictMerge`), baja SÓLO ese resultado a la máquina —
 * sin gatherear, para no pisar la resolución con la versión vieja de la máquina —
 * y actualiza el baseline. La llama el scheduler al reanudar tras un conflicto.
 */
export async function scatterResolved(adapter: PlatformAdapter): Promise<void> {
  const baseline = await loadBaseline(adapter)
  const scatterPlan = await buildVerbPlan(adapter, 'scatter', newMeta())
  const down = safeActions(scatterPlan, baseline)
  if (down.length > 0) await syncScatter(adapter, { ...scatterPlan, actions: down })
  await saveBaseline(adapter, workingCopySnapshot(scatterPlan))
}
