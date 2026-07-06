import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import type { Plan } from './types'

/** Arma el Plan de gather (máquina → repo). */
export function buildGatherPlan(
  ctx: SyncContext,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  return buildPlan(ctx, 'gather', meta)
}

/** Ejecuta un Plan de gather ya previsualizado (con revalidación TOCTOU). */
export function executeGather(
  plan: Plan,
  ctx: SyncContext,
  opts?: { force?: boolean },
): Promise<ExecResult> {
  return executePlan(plan, ctx, opts)
}
