import { randomUUID } from 'node:crypto'
import type { PlatformAdapter } from '../platform'
import { loadBaseline, saveBaseline } from './localState'
import { PlanDriftError } from './plan'
import {
  buildVerbPlan,
  keepMachineEdits,
  pullRepo,
  purgeManagedFromRepo,
  repoGit,
  syncOutgoing,
  syncIncoming,
} from './service'
import type { PendingSummary, Plan, PlanAction } from './types'

/**
 * Result of an auto-sync cycle.
 * - `synced`: everything is up to date (with detail of what moved).
 * - `conflict`: there's a (git) merge conflict to resolve by hand ⇒ the scheduler
 *   pauses and the UI turns red.
 * - `error`: network/git failure ⇒ the scheduler decides on backoff and retries.
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
 * Filters a Plan down to the actions that are "safe" for auto-sync (additive mode +
 * baseline): `create`/`overwrite` always (they never destroy data), and `delete` ONLY
 * if the path was in the baseline — i.e. it's a real removal of a file that was already
 * synced, not a file the other side hasn't seen yet. `noop`/`skip` are dropped. This
 * way a freshly connected machine never wipes the repo, and local deletions propagate
 * without resurrection. See the `runSyncCycle` docs.
 */
function safeActions(plan: Plan, baseline: Set<string>): PlanAction[] {
  return plan.actions.filter((a) => {
    if (a.type === 'create' || a.type === 'overwrite') return true
    if (a.type === 'delete') return baseline.has(a.logicalPath)
    return false
  })
}

/**
 * Set of logicalPaths present in the working copy, read from an incoming plan
 * (where `from` = working copy). It becomes the new baseline when the cycle closes.
 */
function workingCopySnapshot(incomingPlan: Plan): Set<string> {
  const paths = new Set<string>()
  for (const a of incomingPlan.actions) {
    if (a.from !== null && a.type !== 'skip') paths.add(a.logicalPath)
  }
  return paths
}

/**
 * "Signature" of the MACHINE side of an outgoing plan action: the hash of what's
 * on the machine (`hashFrom`, set for create/overwrite/noop — the only thing that
 * leaves it `undefined` is the machine not having the file, i.e. `delete`).
 * Used to tell "the machine changed" apart from "the working copy moved underneath"
 * (e.g. through the phase 1 pull) without the machine having changed a single bit.
 */
function machineSignature(a: PlanAction): string | null {
  return a.hashFrom ?? null
}

/**
 * True if some file changed on the MACHINE side between two outgoing snapshots of
 * the same cycle — never because of a difference coming from the working-copy side
 * (incoming handles that normally; it isn't a race). Compares by logicalPath;
 * `?? null` treats "wasn't in `before`" the same as "the machine didn't have it":
 * a file can first become a "candidate" in `after` because the phase 1 pull added
 * it to the working copy (the machine never had it and still doesn't) — that is
 * NOT a machine change, even though the file doesn't exist in `before.actions`.
 */
function machineChangedSince(before: Plan, after: Plan): boolean {
  const prev = new Map(before.actions.map((a) => [a.logicalPath, machineSignature(a)]))
  return after.actions.some((a) => (prev.get(a.logicalPath) ?? null) !== machineSignature(a))
}

async function attemptCycle(adapter: PlatformAdapter): Promise<SyncOutcome> {
  const git = repoGit(adapter)
  const baseline = await loadBaseline(adapter)
  let pushed = false
  let pulled = false

  // ── Phase 1: push up (machine → working copy), with deletions vetoed by baseline ──
  const outgoingPlan = await buildVerbPlan(adapter, 'outgoing', newMeta())
  const up = safeActions(outgoingPlan, baseline)
  if (up.length > 0) {
    const r = await syncOutgoing(adapter, { ...outgoingPlan, actions: up })
    if (r.conflicts.length > 0) return { kind: 'conflict', files: r.conflicts }
    // We committed but the push didn't land (network down or persistent rejection):
    // that's not "up to date" — the local commit never reached the remote. Exit as an
    // error to retry on the next cycle (without touching the baseline or running incoming).
    if (r.committed && !r.pushed) {
      return { kind: 'error', message: `Push to the remote failed: ${r.pushError ?? ''}`.trim() }
    }
    pushed = r.pushed
    pulled = true // syncOutgoing pulls (merges the remote) after committing
  } else {
    // Nothing to push from local changes: still sync with the remote.
    await git.fetch()
    let st = await git.status()
    if (st.behind > 0) {
      const p = await pullRepo(adapter)
      if (p.conflicts.length > 0) return { kind: 'conflict', files: p.conflicts }
      pulled = true
    }
    // Repo hygiene (#135) AFTER integrating the remote, so this cycle also cleans
    // a cache an older version just pushed back. Its commit rides the push below.
    await purgeManagedFromRepo(adapter)
    st = await git.status()
    // Local commits not pushed yet (e.g. a push that failed in a previous cycle):
    // retry here so we never report "up to date" with something the remote lacks.
    if (st.ahead > 0) {
      const push = await git.push()
      if (!push.ok) {
        return { kind: 'error', message: `Push to the remote failed: ${push.stderr.trim()}` }
      }
      pushed = true
    }
  }

  // ── Phase 1.5: re-check — did the MACHINE change AFTER phase 1 already ran? ──
  // Phase 1 may include a real pull/push (seconds of network). An edit that lands
  // in that window was never seen by the outgoingPlan above, so if we went straight
  // on to building the incoming plan, its own hashTo would already reflect that edit
  // when built — destinationDrifted (the #77 TOCTOU guard) finds nothing odd, because
  // it doesn't compare "this is what outgoing already captured", only "this changed
  // since THIS plan was built". Without this re-check, incoming clobbers the fresh
  // edit with the working copy's old version, with no error or conflict (real bug
  // found while dogfooding, 2026-07-09 — see plan.test.ts for the Plan-level repro).
  //
  // CAREFUL: we compare via `machineChangedSince`, NEVER by "the current outgoing
  // has actions" alone — the branch above (no local changes) may have done a real
  // pull that moves the WORKING COPY (e.g. brings in a delete from another
  // machine), which on its own already produces new diffs without the machine
  // having changed a bit (a file that used to be `noop` now shows up as `create`
  // because the working copy lost it, not because the machine gained it).
  // Treating that as "there's something new" would skip the very incoming that has
  // to delete that file — a false positive that reproduces and breaks
  // syncEngine.test.ts "propagates a directory deletion...". That's why we compare
  // the MACHINE side of the original outgoingPlan against the re-check's: if not a
  // single machine-side hash changed, we carry on with incoming as usual.
  const recheck = await buildVerbPlan(adapter, 'outgoing', newMeta())
  if (machineChangedSince(outgoingPlan, recheck)) {
    return { kind: 'synced', pushed, pulled, incoming: false }
  }

  // ── Phase 2: bring down to the machine (working copy → machine), same vetoes ───
  const incomingPlan = await buildVerbPlan(adapter, 'incoming', newMeta())
  const down = safeActions(incomingPlan, baseline)
  let incoming = false
  if (down.length > 0) {
    await syncIncoming(adapter, { ...incomingPlan, actions: down })
    incoming = true
  }

  // ── Phase 3: baseline := the working copy's synced state (post-pull) ───────────
  await saveBaseline(adapter, workingCopySnapshot(incomingPlan))

  return { kind: 'synced', pushed, pulled, incoming }
}

/**
 * Runs a full auto-sync cycle. Orchestrates the `service.ts` primitives in 3-way
 * mode with a baseline: pushes up local changes (merging the remote via
 * `syncOutgoing`), brings down what the merge brought in, and updates the baseline.
 * Content conflicts between machines are detected by git's `pull` and returned as
 * `conflict`. Never throws: network/git failures come out as `error`, and a
 * `PlanDriftError` (the disk changed between building and executing the Plan)
 * retries once with a fresh plan.
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
 * Counts what's waiting to move (#139) — a dry run, never the network or a write:
 * - up: what the next cycle would push from this machine (same `safeActions` filter
 *   as `attemptCycle`, so a not-yet-seen remote file isn't counted as a local
 *   deletion), plus files in local commits the remote doesn't have yet;
 * - down: files the remote changed as of the last fetch that HEAD doesn't have yet.
 * Paths are deduplicated: an edited file that also sits in an unpushed commit counts once.
 */
export async function pendingSummary(
  adapter: PlatformAdapter,
  now: () => number = Date.now,
): Promise<PendingSummary> {
  const baseline = await loadBaseline(adapter)
  const plan = await buildVerbPlan(adapter, 'outgoing', newMeta())
  const git = repoGit(adapter)
  const up = new Set(safeActions(plan, baseline).map((a) => a.logicalPath))
  const isMemory = (f: string): boolean => f.startsWith('memories/')
  for (const f of await git.changedFiles('@{upstream}...HEAD')) if (isMemory(f)) up.add(f)
  const down = (await git.changedFiles('HEAD...@{upstream}')).filter(isMemory)
  return { up: up.size, down: down.length, checkedAt: now() }
}

/**
 * After a conflict is resolved (the working copy already holds the completed merge,
 * pushed by `completeConflictMerge` or `healManagedConflicts`), lands ONLY that result
 * on the machine — no outgoing first, which would push the machine's stale copies over
 * the remote side of the merge — and refreshes the baseline. The scheduler calls it
 * when resuming after a conflict.
 *
 * `keepMachineEdits` narrows it to files the machine hasn't touched since its last
 * commit: a merge can sit unresolved for days while the user keeps working, and those
 * edits were never committed. Overwriting them (as this used to) lost them for good;
 * now they stay, and the next regular cycle pushes them.
 */
export async function incomingResolved(adapter: PlatformAdapter): Promise<void> {
  const baseline = await loadBaseline(adapter)
  const incomingPlan = await buildVerbPlan(adapter, 'incoming', newMeta())
  const down = await keepMachineEdits(adapter, safeActions(incomingPlan, baseline))
  if (down.length > 0) await syncIncoming(adapter, { ...incomingPlan, actions: down })
  await saveBaseline(adapter, workingCopySnapshot(incomingPlan))
}
