import { randomUUID } from 'node:crypto'
import type { PlatformAdapter } from '../platform'
import { Git } from './git'
import { loadBaseline, saveBaseline } from './localState'
import { PlanDriftError } from './plan'
import { buildVerbPlan, pullRepo, syncOutgoing, syncIncoming, workingCopyDir } from './service'
import type { Plan, PlanAction } from './types'

/**
 * Resultado de un ciclo de auto-sync.
 * - `synced`: quedó todo al día (con detalle de qué se movió).
 * - `conflict`: hay un conflicto de merge (git) por resolver a mano ⇒ el scheduler
 *   se pausa y la UI se pone roja.
 * - `error`: fallo de red/git ⇒ el scheduler decide backoff y reintenta.
 */
export type SyncOutcome =
  | { kind: 'synced'; pushed: boolean; pulled: boolean; incoming: boolean }
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
 * incoming (donde `from` = working copy). Es el nuevo baseline al cerrar el ciclo.
 */
function workingCopySnapshot(incomingPlan: Plan): Set<string> {
  const paths = new Set<string>()
  for (const a of incomingPlan.actions) {
    if (a.from !== null && a.type !== 'skip') paths.add(a.logicalPath)
  }
  return paths
}

/**
 * "Firma" del lado MÁQUINA de una acción de un plan outgoing: el hash de lo que
 * hay en la máquina (`hashFrom`, seteado para create/overwrite/noop — lo único
 * que lo deja `undefined` es que la máquina no tenga el archivo, i.e. `delete`).
 * Sirve para distinguir "la máquina cambió" de "el working copy se movió debajo"
 * (p.ej. por el pull de la fase 1) sin que la máquina haya cambiado un bit.
 */
function machineSignature(a: PlanAction): string | null {
  return a.hashFrom ?? null
}

/**
 * True si algún archivo cambió de lado MÁQUINA entre dos snapshots outgoing del
 * mismo ciclo — nunca por una diferencia que viene del lado working copy (eso lo
 * resuelve incoming normalmente, no es una carrera). Compara por logicalPath;
 * `?? null` trata "no estaba en `before`" igual que "la máquina no lo tenía":
 * un archivo puede volverse "candidato" recién en `after` porque el pull de la
 * fase 1 lo agregó al working copy (la máquina nunca lo tuvo ni lo tiene) — eso
 * NO es un cambio de máquina, aunque el archivo no exista en `before.actions`.
 */
function machineChangedSince(before: Plan, after: Plan): boolean {
  const prev = new Map(before.actions.map((a) => [a.logicalPath, machineSignature(a)]))
  return after.actions.some((a) => (prev.get(a.logicalPath) ?? null) !== machineSignature(a))
}

async function attemptCycle(adapter: PlatformAdapter): Promise<SyncOutcome> {
  const git = new Git(workingCopyDir(adapter))
  const baseline = await loadBaseline(adapter)
  let pushed = false
  let pulled = false

  // ── Fase 1: subir (máquina → working copy), con borrados vetados por baseline ──
  const outgoingPlan = await buildVerbPlan(adapter, 'outgoing', newMeta())
  const up = safeActions(outgoingPlan, baseline)
  if (up.length > 0) {
    const r = await syncOutgoing(adapter, { ...outgoingPlan, actions: up })
    if (r.conflicts.length > 0) return { kind: 'conflict', files: r.conflicts }
    // Commiteamos pero el push no entró (red caída o rechazo persistente): no es
    // "al día" — el commit local quedó sin llegar al remoto. Salimos como error
    // para reintentar en el próximo ciclo (sin tocar baseline ni scattear).
    if (r.committed && !r.pushed) {
      return { kind: 'error', message: 'No se pudo pushear el commit al remoto' }
    }
    pushed = r.pushed
    pulled = true // syncOutgoing pullea (merge del remoto) tras commitear
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

  // ── Fase 1.5: re-chequeo — ¿la MÁQUINA cambió DESPUÉS de que fase 1 ya corrió? ──
  // Fase 1 puede incluir un pull/push real (segundos de red). Un edit que aterriza
  // en esa ventana nunca lo vio el outgoingPlan de arriba, así que si seguimos
  // directo a construir el incoming, su propio hashTo ya reflejaría ese edit al
  // armarse — destinationDrifted (TOCTOU de #77) no encuentra nada raro, porque
  // no compara "esto es lo que outgoing ya capturó", solo "esto cambió desde que
  // ESTE plan se armó". Sin este re-chequeo, incoming pisa el edit fresco con la
  // versión vieja del working copy, sin error ni conflicto (bug real encontrado
  // dogfooding, 2026-07-09 — ver plan.test.ts para la reproducción a nivel Plan).
  //
  // OJO: comparamos por `machineChangedSince`, NUNCA por "el outgoing de ahora
  // tiene acciones" a secas — la rama de arriba (sin cambios locales) puede
  // haber hecho un pull real que mueve el WORKING COPY (p.ej. trae un delete de
  // otra máquina), lo que por sí solo ya genera diffs nuevos sin que la máquina
  // haya cambiado un bit (un archivo que antes era `noop` pasa a verse como
  // `create` porque el working copy lo perdió, no porque la máquina lo ganara).
  // Tratar eso como "hay algo nuevo" saltearía el incoming que justamente tiene
  // que borrar ese archivo — falso positivo que reproduce y rompe
  // syncEngine.test.ts "propagates a directory deletion...". Por eso comparamos
  // el lado MÁQUINA del outgoingPlan original contra el del re-chequeo: si no
  // cambió ni un hash del lado máquina, seguimos con incoming normalmente.
  const recheck = await buildVerbPlan(adapter, 'outgoing', newMeta())
  if (machineChangedSince(outgoingPlan, recheck)) {
    return { kind: 'synced', pushed, pulled, incoming: false }
  }

  // ── Fase 2: bajar a la máquina (working copy → máquina), mismos vetos ──────────
  const incomingPlan = await buildVerbPlan(adapter, 'incoming', newMeta())
  const down = safeActions(incomingPlan, baseline)
  let incoming = false
  if (down.length > 0) {
    await syncIncoming(adapter, { ...incomingPlan, actions: down })
    incoming = true
  }

  // ── Fase 3: baseline := estado sincronizado del working copy (post-pull) ───────
  await saveBaseline(adapter, workingCopySnapshot(incomingPlan))

  return { kind: 'synced', pushed, pulled, incoming }
}

/**
 * Corre un ciclo completo de auto-sync. Orquesta las primitivas de `service.ts`
 * en modo 3-vías con baseline: sube los cambios locales (mergeando el remoto vía
 * `syncOutgoing`), baja lo que trajo el merge, y actualiza el baseline. Los conflictos
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
 * sin subir cambios (outgoing), para no pisar la resolución con la versión vieja de la máquina —
 * y actualiza el baseline. La llama el scheduler al reanudar tras un conflicto.
 */
export async function incomingResolved(adapter: PlatformAdapter): Promise<void> {
  const baseline = await loadBaseline(adapter)
  const incomingPlan = await buildVerbPlan(adapter, 'incoming', newMeta())
  const down = safeActions(incomingPlan, baseline)
  if (down.length > 0) await syncIncoming(adapter, { ...incomingPlan, actions: down })
  await saveBaseline(adapter, workingCopySnapshot(incomingPlan))
}
