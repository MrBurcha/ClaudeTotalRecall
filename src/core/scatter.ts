import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import type { Plan } from './types'

/** Arma el Plan de scatter (repo → máquina). */
export function buildScatterPlan(
  ctx: SyncContext,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  return buildPlan(ctx, 'scatter', meta)
}

/** Ejecuta un Plan de scatter ya previsualizado (con revalidación TOCTOU). */
export function executeScatter(
  plan: Plan,
  ctx: SyncContext,
  opts?: { force?: boolean },
): Promise<ExecResult> {
  return executePlan(plan, ctx, opts)
}
