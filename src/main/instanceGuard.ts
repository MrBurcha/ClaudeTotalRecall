import type { PlatformAdapter } from '../platform'
import { acquireInstanceLock, type InstanceLock, type LockKind } from '../core/instanceLock'

/** While a CLI command holds the lock we poll often: those finish in seconds. */
const RETRY_CLI_MS = 2_000
/** Another app copy can stay open for hours: no need to hammer the file. */
const RETRY_APP_MS = 15_000

export interface InstanceGuardHooks {
  /** This process now owns the machine: start (or restart) syncing. */
  onAcquired(): void
  /** Someone else owns it (pid 0 = unreadable lock file): stop syncing and say why. */
  onBlocked(by: { kind: LockKind; pid: number }): void
}

/**
 * App-side owner of the cross-process sync lock (#141). Takes the lock at startup,
 * keeps it alive, and when another process holds it, keeps this copy from syncing
 * and retries until the other one is gone.
 *
 * Fails OPEN: if the lock file itself can't be written (permissions, odd FS), the
 * app syncs as it did before the lock existed rather than refusing to work.
 */
export class InstanceGuard {
  private lock: InstanceLock | null = null
  private failOpen = false
  private retryTimer: NodeJS.Timeout | null = null
  private stopped = false
  private acquiring = false

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly hooks: InstanceGuardHooks,
  ) {}

  /** May this process mutate the working copy right now? */
  get held(): boolean {
    return this.failOpen || this.lock !== null
  }

  async start(): Promise<void> {
    await this.tryAcquire()
  }

  /** After the machine wakes up: re-assert the heartbeat right away. */
  async check(): Promise<void> {
    if (this.lock && !(await this.lock.heartbeat().catch(() => true))) this.lost()
    else if (!this.held) await this.tryAcquire()
  }

  /** On quit: give the lock back synchronously (async work wouldn't finish). */
  stop(): void {
    this.stopped = true
    this.clearRetry()
    this.lock?.releaseSync()
    this.lock = null
  }

  private async tryAcquire(): Promise<void> {
    if (this.stopped || this.held || this.acquiring) return
    this.acquiring = true
    try {
      const r = await acquireInstanceLock(this.adapter, 'app')
      if (this.stopped) {
        if (r.acquired) r.lock.releaseSync()
        return
      }
      if (r.acquired) {
        this.lock = r.lock
        r.lock.startHeartbeat(() => this.lost())
        this.hooks.onAcquired()
        return
      }
      this.hooks.onBlocked(
        r.holder ? { kind: r.holder.kind, pid: r.holder.pid } : { kind: 'app', pid: 0 },
      )
      this.scheduleRetry(r.holder?.kind === 'cli' ? RETRY_CLI_MS : RETRY_APP_MS)
    } catch (e) {
      console.error('[instance-lock] could not take the lock file; syncing without it', e)
      this.failOpen = true
      this.hooks.onAcquired()
    } finally {
      this.acquiring = false
    }
  }

  private lost(): void {
    this.lock = null
    void this.tryAcquire()
  }

  private scheduleRetry(ms: number): void {
    this.clearRetry()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.tryAcquire()
    }, ms)
    this.retryTimer.unref?.()
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
