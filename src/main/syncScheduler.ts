import { watch, type FSWatcher } from 'node:fs'
import { createPlatformAdapter, type PlatformAdapter } from '../platform'
import { classifyRemoteError } from '../core/gitAuth'
import {
  loadAutoSyncPrefs,
  loadLastSyncedAt,
  saveAutoSyncPrefs,
  saveLastSyncedAt,
} from '../core/localState'
import { isExcludedRel } from '../core/managedPaths'
import { isSecretExcluded } from '../core/plan'
import { withRepoLock } from '../core/repoLock'
import { projectSlotPath, projectSlots, userLevelItems } from '../core/resolve'
import * as svc from '../core/service'
import {
  incomingResolved,
  pendingSummary,
  runSyncCycle,
  type SyncOutcome,
} from '../core/syncEngine'
import type { AutoSyncPrefs, SyncEngineState } from '../core/types'

// The watch uses native OS notifications (inotify/FSEvents): ~0% CPU when
// idle. The trailing debounce coalesces bursts of saves into a single cycle.
const DEBOUNCE_MS = 10_000
/** With auto-sync off a change only refreshes the pending count: a short debounce is enough. */
const COUNT_DEBOUNCE_MS = 3_000
/** The pending count also refreshes on this beat, auto-sync on or off (#139). */
const PENDING_REFRESH_MS = 180_000
/** Focus can fire in bursts (alt-tab): don't recount more often than this unless forced. */
const PENDING_THROTTLE_MS = 10_000

/** A watched sync root; `exclude` = top-level entries whose changes are ignored (#135). */
interface WatchTarget {
  path: string
  recursive: boolean
  exclude: readonly string[]
}
const MIN_INTERVAL_MS = 15_000
const MAX_INTERVAL_MS = 3_600_000

function clampInterval(ms: number): number {
  return Math.min(Math.max(ms, MIN_INTERVAL_MS), MAX_INTERVAL_MS)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Noise the watcher must ignore so it doesn't wake up for nothing: secrets
 * (`*.jsonl`, `.credentials.json`, `.claude.json`), which never sync anyway,
 * and directories that change a lot and add nothing (`.git`, `node_modules`).
 */
function isNoise(rel: string): boolean {
  if (isSecretExcluded(rel)) return true
  const segs = rel.split(/[\\/]/)
  return segs.includes('.git') || segs.includes('node_modules')
}

/**
 * A failed cycle: "offline" only when the network really failed; anything else (no
 * access to the repo, a git or disk error) is an "error" with its text, so a
 * permanent problem doesn't pass for a blip that fixes itself (#132).
 */
function failureState(
  message: string,
): Pick<SyncEngineState, 'status' | 'lastError' | 'errorKind'> {
  const kind = classifyRemoteError(message)
  return { status: kind === 'network' ? 'offline' : 'error', lastError: message, errorKind: kind }
}

/**
 * Auto-sync engine of the main process. Owns the *timing* (file watch + remote
 * poll), the state machine, and pushing state to the UI. Has NO git logic: it
 * delegates to `runSyncCycle` (core). Runs only while the app is open.
 *
 * Three independent beats (#139):
 * - the file watch runs whenever the machine is ready — with auto-sync on a change
 *   schedules a cycle, with it off it only recounts what's pending;
 * - the remote poll (a full cycle every `intervalMs`) runs only with auto-sync on;
 * - the pending count refreshes on its own slow beat, after every cycle, on window
 *   focus and on Notebook saves — always read-only, never the network.
 */
export class SyncScheduler {
  private readonly adapter: PlatformAdapter = createPlatformAdapter()
  private state: SyncEngineState = {
    status: 'idle',
    auto: true,
    intervalMs: 120_000,
    lastSyncedAt: null,
    pending: null,
    conflicts: [],
    lastError: null,
    errorKind: null,
    blockedBy: null,
  }

  private ready = false
  /** Another process owns this machine's sync lock (#141): never cycle or arm. */
  private blocked = false
  private inFlight = false
  /** a cycle was requested while one was running: run once more when it ends */
  private rerunQueued = false
  private watching = false
  private watchers: FSWatcher[] = []
  private pollTimer: NodeJS.Timeout | null = null
  private pendingTimer: NodeJS.Timeout | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private counting = false
  private lastCountAt = 0

  constructor(private readonly broadcast: (state: SyncEngineState) => void) {}

  getState(): SyncEngineState {
    return this.state
  }

  /**
   * Called by the instance guard: a holder means another process syncs this machine,
   * so this copy stands down (timers off, no cycles); null hands control back.
   */
  setBlocked(blockedBy: SyncEngineState['blockedBy']): void {
    this.blocked = blockedBy !== null
    if (this.blocked) this.disarm()
    const prev = this.state.blockedBy
    if (prev?.pid !== blockedBy?.pid || prev?.kind !== blockedBy?.kind) this.setState({ blockedBy })
  }

  /** true if the engine is paused waiting for a conflict resolution. */
  private get pausedByConflict(): boolean {
    return this.state.status === 'conflict'
  }

  /** Starts on whenReady: reads prefs, converges once, and arms watch+poll if auto. */
  async start(): Promise<void> {
    await this.reload()
  }

  /** Stops everything (before-quit): closes watchers and timers. */
  stop(): void {
    this.disarm()
  }

  /** Re-reads prefs/readiness and re-arms. Called by machine:register once it completes. */
  async reload(): Promise<void> {
    const prefs = await loadAutoSyncPrefs(this.adapter)
    // "Last synced" survives a restart, so a machine that sat with auto-sync off for
    // days says so instead of starting from a blank "never" (#139).
    const lastSyncedAt = this.state.lastSyncedAt ?? (await loadLastSyncedAt(this.adapter))
    this.setState({
      auto: prefs.enabled,
      intervalMs: clampInterval(prefs.intervalMs),
      lastSyncedAt,
    })
    this.ready = await this.isReady()
    if (this.ready && this.state.auto) await this.cycle()
    else void this.refreshPending(true)
    this.reconcileTimers()
  }

  /** Changes the prefs (persisted), re-arms with the new interval, converges if just enabled. */
  async setAuto(prefs: AutoSyncPrefs): Promise<SyncEngineState> {
    const clamped = { enabled: prefs.enabled, intervalMs: clampInterval(prefs.intervalMs) }
    await saveAutoSyncPrefs(this.adapter, clamped)
    const wasOff = !this.state.auto
    this.disarm() // force re-arming with the new interval
    this.setState({ auto: clamped.enabled, intervalMs: clamped.intervalMs })
    this.reconcileTimers()
    if (wasOff && clamped.enabled && this.ready) void this.cycle()
    else void this.refreshPending(true)
    return this.state
  }

  /** Manual trigger ("Sync now"): runs even when auto is off; not while in conflict. */
  async syncNow(): Promise<SyncEngineState> {
    if (!this.pausedByConflict) await this.cycle()
    return this.state
  }

  /** After finishing a merge in the Advanced panel: brings the result down and resumes. */
  async resumeAfterConflict(): Promise<void> {
    try {
      await withRepoLock(() => incomingResolved(this.adapter))
      this.setState({ status: 'idle', conflicts: [], lastError: null, errorKind: null })
      this.markSynced()
    } catch (e) {
      this.setState(failureState(errorMessage(e)))
    }
    this.reconcileTimers()
    void this.refreshPending(true)
  }

  /**
   * The app committed to the working copy on its own (a Notebook save, #139): count it
   * as pending right away, and with auto-sync on, upload it shortly instead of waiting
   * for the next poll.
   */
  onWorkingCopyCommit(): void {
    void this.refreshPending(true)
    if (this.ready && !this.blocked && this.state.auto && !this.pausedByConflict) {
      this.onLocalChange()
    }
  }

  /**
   * Recounts what's pending (#139): a dry run under the working-copy lock, so it never
   * reads a half-applied plan or races a commit for git's index lock. Never touches
   * the network. Skipped while a cycle runs (the cycle recounts when it ends).
   */
  async refreshPending(force = false): Promise<void> {
    if (!this.ready || this.blocked || this.inFlight || this.counting || this.pausedByConflict) {
      return
    }
    if (!force && Date.now() - this.lastCountAt < PENDING_THROTTLE_MS) return
    this.counting = true
    try {
      const pending = await withRepoLock(() => pendingSummary(this.adapter))
      this.lastCountAt = Date.now()
      this.setState({ pending })
    } catch {
      /* a transient read failure keeps the last count; the next beat retries */
    } finally {
      this.counting = false
    }
  }

  // ── cycle (mutex + rerun) ────────────────────────────────────────────────────
  private async cycle(): Promise<void> {
    if (this.pausedByConflict || this.blocked) return
    if (this.inFlight) {
      this.rerunQueued = true
      return
    }
    this.inFlight = true
    try {
      if (!(await this.isReady())) {
        this.ready = false
        this.disarm()
        return
      }
      this.ready = true
      // The whole cycle runs under the working-copy lock (#111), the same one
      // Notebook saves and config edits take, so no other git mutation of this app
      // can interleave with it (no `.git/index.lock` races, no pull over a tree a
      // plan left dirty). None of the core calls below take the lock themselves:
      // it isn't reentrant.
      await withRepoLock(async () => {
        // Guard: if the working copy already has conflicts (from a manual flow or a
        // previous cycle), don't sync; ask for a resolution — after self-healing the
        // Claude-managed ones (#135). A merge stuck ONLY on those (e.g. left by an
        // older version) completes here and lands like a manual resolution would.
        const existing = await svc.listConflicts(this.adapter)
        if (existing.length > 0) {
          const heal = await svc.healManagedConflicts(this.adapter)
          if (!heal.completed) {
            this.setState({ status: 'conflict', conflicts: heal.remaining })
            this.reconcileTimers()
            return
          }
          await incomingResolved(this.adapter)
          this.applyOutcome({ kind: 'synced', pushed: heal.pushed, pulled: true, incoming: true })
          return
        }
        this.setState({ status: 'syncing', lastError: null, errorKind: null })
        const outcome = await runSyncCycle(this.adapter)
        this.applyOutcome(outcome)
        // Automatic shared-config rename (#123): mark this machine, rename once the
        // whole fleet runs Engram. Bookkeeping only — it never fails a sync.
        if (outcome.kind === 'synced') {
          await svc.advanceSharedConfigRename(this.adapter).catch((e: unknown) => {
            console.error('[engram] shared-config rename step failed', e)
          })
        }
      })
    } catch (e) {
      this.applyOutcome({ kind: 'error', message: errorMessage(e) })
    } finally {
      this.inFlight = false
      if (this.rerunQueued) {
        this.rerunQueued = false
        if (!this.pausedByConflict) void this.cycle()
      } else {
        void this.refreshPending(true)
      }
    }
  }

  private applyOutcome(o: SyncOutcome): void {
    if (o.kind === 'synced') {
      this.setState({ status: 'idle', conflicts: [], lastError: null, errorKind: null })
      this.markSynced()
    } else if (o.kind === 'conflict') {
      this.setState({ status: 'conflict', conflicts: o.files })
    } else {
      this.setState(failureState(o.message))
    }
    this.reconcileTimers()
  }

  /** A cycle confirmed this machine and the remote agree: remember when (persisted). */
  private markSynced(): void {
    const at = Date.now()
    this.setState({ lastSyncedAt: at })
    void saveLastSyncedAt(this.adapter, at).catch(() => {
      /* bookkeeping only: the next sync writes it again */
    })
  }

  private async isReady(): Promise<boolean> {
    const machineId = await svc.currentMachineId(this.adapter).catch(() => null)
    if (!machineId) return false
    const config = await svc.loadRepoConfig(this.adapter).catch(() => null)
    return !!config
  }

  // ── arming/disarming watch + poll + pending beat ─────────────────────────────
  private reconcileTimers(): void {
    const live = this.ready && !this.blocked
    // Watch even with auto-sync off: a change then only recounts what's pending.
    if (live && !this.pausedByConflict) this.armWatchers()
    else this.disarmWatchers()
    if (live && this.state.auto && !this.pausedByConflict) this.armPoll()
    else this.disarmPoll()
    if (live) this.armPendingBeat()
    else this.disarmPendingBeat()
  }

  private armWatchers(): void {
    if (this.watching) return
    this.watching = true
    void this.setupWatchers()
  }

  private disarmWatchers(): void {
    this.watching = false
    for (const w of this.watchers) {
      try {
        w.close()
      } catch {
        /* already closed */
      }
    }
    this.watchers = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private armPoll(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.cycle(), this.state.intervalMs)
    this.pollTimer.unref?.()
  }

  private disarmPoll(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private armPendingBeat(): void {
    if (this.pendingTimer) return
    this.pendingTimer = setInterval(() => void this.refreshPending(true), PENDING_REFRESH_MS)
    this.pendingTimer.unref?.()
  }

  private disarmPendingBeat(): void {
    if (this.pendingTimer) clearInterval(this.pendingTimer)
    this.pendingTimer = null
  }

  private disarm(): void {
    this.disarmWatchers()
    this.disarmPoll()
    this.disarmPendingBeat()
  }

  /**
   * Trailing debounce with reset: every change restarts the quiet window. With
   * auto-sync on it ends in a cycle; with it off, only in a recount (#139).
   */
  private onLocalChange(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    const auto = this.state.auto
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null
        if (this.state.auto) void this.cycle()
        else void this.refreshPending(true)
      },
      auto ? DEBOUNCE_MS : COUNT_DEBOUNCE_MS,
    )
    this.debounceTimer.unref?.()
  }

  /**
   * Watches ONLY the synced roots (not the whole home): `~/.claude` non-recursively
   * (catches CLAUDE.md and settings.json without descending into projects/*.jsonl),
   * the user-level dirs recursively, and this machine's project folders.
   */
  private async setupWatchers(): Promise<void> {
    for (const t of await this.watchTargets()) {
      if (!this.watching) return // disarmed while the targets were being resolved
      try {
        const w = watch(t.path, { recursive: t.recursive }, (_evt, filename) => {
          if (filename) {
            const rel = filename.toString()
            // Claude Code refreshes its own skills cache on its own (#135): never a reason to sync.
            if (isNoise(rel) || isExcludedRel(rel, t.exclude)) return
          }
          this.onLocalChange()
        })
        w.on('error', () => {
          /* path deleted or unsupported OS: ignored, the poll covers it anyway */
        })
        w.unref?.()
        this.watchers.push(w)
      } catch {
        /* nonexistent path or OS without recursive watch: the poll covers it */
      }
    }
  }

  private async watchTargets(): Promise<WatchTarget[]> {
    const a = this.adapter
    const targets: WatchTarget[] = [{ path: a.claudeHome(), recursive: false, exclude: [] }]
    for (const item of userLevelItems(a)) {
      if (item.kind === 'dir') {
        targets.push({ path: item.realPath, recursive: true, exclude: item.exclude })
      }
    }
    const config = await svc.loadRepoConfig(a).catch(() => null)
    const machineId = await svc.currentMachineId(a).catch(() => null)
    if (config && machineId) {
      for (const name of Object.keys(config.projects)) {
        for (const slot of projectSlots(config, name)) {
          const p = projectSlotPath(config, name, slot, machineId)
          if (p) targets.push({ path: p, recursive: true, exclude: [] })
        }
      }
    }
    return targets
  }

  private setState(patch: Partial<SyncEngineState>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast(this.state)
  }
}
