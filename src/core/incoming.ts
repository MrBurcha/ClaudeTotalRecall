import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import type { Plan } from './types'

/** Builds the incoming Plan (repo → machine). */
export function buildIncomingPlan(
  ctx: SyncContext,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  return buildPlan(ctx, 'incoming', meta)
}

/** Executes an already-previewed incoming Plan (with TOCTOU revalidation). */
export function executeIncoming(
  plan: Plan,
  ctx: SyncContext,
  opts?: { force?: boolean },
): Promise<ExecResult> {
  return executePlan(plan, ctx, opts)
}
