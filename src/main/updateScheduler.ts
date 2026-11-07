import {
  checkForNewRelease,
  currentVersionInstaller,
  isWrongBuild,
  RELEASES_PAGE_URL,
  type MachineFacts,
  type UpdateState,
} from '../core/releaseCheck'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Checks GitHub for a newer stable release than the running app, linked to this
 * machine's installer (#134). Runs an initial check as soon as it's started, then
 * again every 24h for as long as the app stays open — always via a fresh network
 * call (no persisted throttle), per #66.
 *
 * When this is the wrong build for the hardware (the Intel build under Rosetta,
 * #133), it also resolves the right installer of the CURRENT version. That notice
 * shows from the start, linked to the releases page until the exact asset is found.
 */
export class UpdateScheduler {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly facts: MachineFacts,
    private readonly broadcast: (state: UpdateState) => void,
  ) {
    this.state = {
      update: null,
      wrongBuild: isWrongBuild(facts) ? { url: RELEASES_PAGE_URL, variant: null } : null,
    }
  }

  getState(): UpdateState {
    return this.state
  }

  start(): void {
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async check(): Promise<void> {
    // Only until the exact asset is known: the current version's assets never change.
    const resolveWrongBuild = !!this.state.wrongBuild && this.state.wrongBuild.variant === null
    const [latest, wrongBuild] = await Promise.all([
      checkForNewRelease(this.currentVersion, this.facts),
      resolveWrongBuild ? currentVersionInstaller(this.currentVersion, this.facts) : null,
    ])
    // A transient failure (offline, GitHub down) keeps the last known result rather
    // than flickering an already-shown banner off — it just tries again next cycle.
    if (!latest.ok && !wrongBuild) return
    this.state = {
      update: latest.ok ? latest.update : this.state.update,
      wrongBuild: wrongBuild ?? this.state.wrongBuild,
    }
    this.broadcast(this.state)
  }
}
