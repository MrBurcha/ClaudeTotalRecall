import { checkForNewRelease, RELEASES_PAGE_URL, type UpdateState } from '../core/releaseCheck'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Checks GitHub for a newer stable release than the running app. Runs an initial
 * check as soon as it's started, then again every 24h for as long as the app stays
 * open — always via a fresh network call (no persisted throttle), per #66.
 */
export class UpdateScheduler {
  private state: UpdateState = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly currentVersion: string,
    private readonly broadcast: (state: UpdateState) => void,
  ) {}

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
    const result = await checkForNewRelease(this.currentVersion)
    // A transient failure (offline, GitHub down) keeps the last known result rather
    // than flickering an already-shown banner off — it just tries again next cycle.
    if (!result.ok) return
    this.state = result.latestVersion
      ? { latestVersion: result.latestVersion, releasesUrl: RELEASES_PAGE_URL }
      : null
    this.broadcast(this.state)
  }
}
