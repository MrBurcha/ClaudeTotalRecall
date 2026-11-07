import type { TFunction } from 'i18next'
import type { SyncEngineState } from '../../../core/types'
import { relativeParts } from './relativeTime'

/**
 * What the sync bar says (#139). Pure (takes `now` and `t`) so it runs under the
 * node test suite.
 *
 * The rule it enforces: "Up to date" only when it's TRUE — nothing waiting on this
 * machine, and with auto-sync off, only right after a sync actually confirmed it.
 * Before, the label meant "the engine is idle", so with auto-sync off it read
 * "Up to date" for days while edits piled up unsynced.
 */
export type SummaryTone = 'danger' | 'warn' | 'ok' | 'muted'

export interface SyncSummary {
  label: string
  meta: string
  tone: SummaryTone
  /** auto-sync is off and something is waiting: offer to turn it back on */
  offerAutoOn: boolean
}

/** How long after a confirmed sync the bar may still say "Up to date" with auto-sync off. */
export const FRESH_MS = 5 * 60_000

function checkedText(at: number | null, now: number, t: TFunction): string {
  if (!at) return t('home.meta.neverChecked')
  const p = relativeParts(at, now)
  const time =
    p.key === 'now' ? t('relativeTime.now') : t(`relativeTime.${p.key}`, { count: p.count })
  return t('home.meta.lastChecked', { time })
}

export function summarizeSync(
  engine: SyncEngineState | null,
  conflictCount: number,
  now: number,
  t: TFunction,
): SyncSummary {
  const base = { offerAutoOn: false }
  if (conflictCount > 0 || engine?.status === 'conflict') {
    return {
      ...base,
      label: t('home.status.conflict'),
      meta: t('home.meta.toResolve', { count: conflictCount }),
      tone: 'danger',
    }
  }
  if (!engine) return { ...base, label: t('home.status.loading'), meta: '', tone: 'muted' }
  if (engine.blockedBy) {
    return {
      ...base,
      label: t('home.status.blocked'),
      meta: engine.blockedBy.kind === 'cli' ? t('home.meta.blockedCli') : t('home.meta.blockedApp'),
      tone: 'warn',
    }
  }
  if (engine.status === 'syncing') {
    return { ...base, label: t('home.status.syncing'), meta: t('home.meta.syncing'), tone: 'ok' }
  }
  if (engine.status === 'offline') {
    return { ...base, label: t('home.status.offline'), meta: t('home.meta.offline'), tone: 'warn' }
  }
  if (engine.status === 'error') {
    const access = engine.errorKind === 'access'
    return {
      ...base,
      label: access ? t('home.status.noAccess') : t('home.status.error'),
      meta: access ? t('home.meta.noAccess') : t('home.meta.error'),
      tone: 'danger',
    }
  }

  // Idle: what the bar says depends on what's actually waiting.
  const { auto, pending, lastSyncedAt } = engine
  const checked = checkedText(lastSyncedAt, now, t)
  const autoText = auto ? t('home.meta.autoOn') : t('home.meta.autoOff')
  const up = pending?.up ?? 0
  const down = pending?.down ?? 0

  if (up > 0 || down > 0) {
    const label =
      up > 0
        ? t('home.status.pending', { count: up })
        : t('home.status.toDownload', { count: down })
    if (auto) {
      return { ...base, label, meta: t('home.meta.movingSoon'), tone: 'ok' }
    }
    // Off + waiting: warn, say why nothing moves, and offer the way back.
    return {
      label,
      meta: [t('home.meta.autoOffWaiting'), checked].join(' · '),
      tone: 'warn',
      offerAutoOn: true,
    }
  }

  if (auto) {
    const bits = lastSyncedAt ? [checked, autoText] : [autoText]
    return { ...base, label: t('home.status.upToDate'), meta: bits.join(' · '), tone: 'ok' }
  }
  if (!pending) {
    // Off and not counted yet (the first count runs right after startup).
    return { ...base, label: t('home.status.checking'), meta: autoText, tone: 'muted' }
  }
  // Off, nothing waiting HERE — but nobody looked at the repo since the last sync.
  const fresh = lastSyncedAt !== null && now - lastSyncedAt < FRESH_MS
  return {
    ...base,
    label: fresh ? t('home.status.upToDate') : t('home.status.noLocalChanges'),
    meta: [checked, autoText].join(' · '),
    tone: 'muted',
  }
}
