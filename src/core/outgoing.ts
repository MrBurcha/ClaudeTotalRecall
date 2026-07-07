import { buildPlan, executePlan, type ExecResult, type SyncContext } from './plan'
import type { Plan } from './types'

/** Builds the outgoing Plan (machine → repo). */
export function buildOutgoingPlan(
  ctx: SyncContext,
  meta: { id: string; createdAt: string },
): Promise<Plan> {
  return buildPlan(ctx, 'outgoing', meta)
}

/** Executes an already-previewed outgoing Plan (with TOCTOU revalidation). */
export function executeOutgoing(
  plan: Plan,
  ctx: SyncContext,
  opts?: { force?: boolean },
): Promise<ExecResult> {
  return executePlan(plan, ctx, opts)
}
