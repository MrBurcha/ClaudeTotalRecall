/**
 * A process-wide FIFO async mutex serializing working-copy git mutations.
 *
 * The app mutates a single git working copy (`~/.config/claudetr/repo`) from
 * several independent, concurrent entry points: Notebook saves and config/machine
 * edits (IPC handlers) and the auto-sync cycle (scheduler). These run on the same
 * main-process event loop but interleave across `await` points. Without a lock a
 * Notebook save (a local commit) could land in the middle of `commitConfigChange`'s
 * `fetch → reset --hard origin` sequence and be silently discarded (#104 review).
 *
 * `withRepoLock` chains each operation after the previous one settles — success OR
 * failure — so a failed op never wedges the queue. It is NOT reentrant: a locked
 * operation must never call another locked operation, or it deadlocks.
 */
let tail: Promise<unknown> = Promise.resolve()

const swallow = (): void => {}

export function withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  tail = run.then(swallow, swallow)
  return run
}
