import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import { Constellation } from '../features/constellation/Constellation'
import { AdvancedSync } from '../features/sync/AdvancedSync'
import { AutoToggle } from '../features/sync/AutoToggle'
import { RecentActivity } from '../features/sync/RecentActivity'
import { SyncNowButton } from '../features/sync/SyncNowButton'
import { relativeParts } from '../features/sync/relativeTime'
import { conflictFiles, engineTone, hasConflict, onboardingStep } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

/** Sync-bar status text driven by the engine. */
function statusLabel(state: ReturnType<typeof useAppState>, t: TFunction): string {
  if (hasConflict(state)) return t('home.status.conflict')
  const eng = state.syncEngine
  if (!eng) return t('home.status.loading')
  if (eng.status === 'syncing') return t('home.status.syncing')
  if (eng.status === 'offline') return t('home.status.offline')
  return t('home.status.upToDate')
}

/**
 * The sub-line reads "last checked", not "last synced": `lastSyncedAt` bumps on
 * every successful poll even when nothing changed, so it's really the last time
 * we verified the repo — being up to date isn't the same as having just changed
 * something. The "last change" story lives in Recent activity instead (#39).
 */
function lastCheckedText(at: number, now: number, t: TFunction): string {
  const p = relativeParts(at, now)
  const time =
    p.key === 'now' ? t('relativeTime.now') : t(`relativeTime.${p.key}`, { count: p.count })
  return t('home.meta.lastChecked', { time })
}

function statusMeta(state: ReturnType<typeof useAppState>, now: number, t: TFunction): string {
  const eng = state.syncEngine
  if (hasConflict(state)) return t('home.meta.toResolve', { count: conflictFiles(state).length })
  if (!eng) return ''
  if (eng.status === 'syncing') return t('home.meta.syncing')
  if (eng.status === 'offline') return t('home.meta.offline')
  const bits: string[] = []
  if (eng.lastSyncedAt) bits.push(lastCheckedText(eng.lastSyncedAt, now, t))
  bits.push(eng.auto ? t('home.meta.autoOn') : t('home.meta.autoOff'))
  return bits.join(' · ')
}

export function SyncHome(): JSX.Element {
  const { t } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const { config, status, machineId, activeOp, loading, syncEngine } = state
  const files = conflictFiles(state)
  const conflict = hasConflict(state)
  const tone = engineTone(state)
  const syncing = syncEngine?.status === 'syncing'

  const [advOpen, setAdvOpen] = useState(false)
  const advRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (conflict) setAdvOpen(true)
  }, [conflict])

  // Refresh the "time ago" of the last sync without relying on a backend event.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(timer)
  }, [])

  const goResolve = (): void => {
    setAdvOpen(true)
    requestAnimationFrame(() =>
      advRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }

  const dotTone = conflict
    ? 'danger'
    : tone === 'offline'
      ? 'warn'
      : syncEngine?.auto
        ? 'ok'
        : 'muted'

  return (
    <div className="view">
      <div className="view__head">
        <span className="view__eyebrow">{t('home.eyebrow')}</span>
        <h1 className="view__title">{t('home.title')}</h1>
        <p className="view__sub">{t('home.sub')}</p>
      </div>

      {loading ? (
        <Skeleton h={300} radius={14} />
      ) : (
        <Constellation
          machines={config?.machines ?? {}}
          currentId={machineId}
          status={status}
          activeOp={activeOp}
          tone={tone}
        />
      )}

      <div className={`sync-bar${conflict ? ' sync-bar--danger' : ''}`}>
        <div className="sync-bar__status">
          {syncing ? (
            <Icon name="sync" size={18} className="icon--spin" />
          ) : (
            <StatusDot tone={dotTone} />
          )}
          <div className="stack stack-1">
            <span className="sync-bar__state">{statusLabel(state, t)}</span>
            <span className="sync-bar__meta muted mono">{statusMeta(state, now, t)}</span>
          </div>
        </div>
        <div className="cluster">
          <AutoToggle />
          <SyncNowButton />
        </div>
      </div>

      {conflict && (
        <div className="card card--danger">
          <div className="row between">
            <span className="cluster">
              <Icon name="alert" size={18} />
              {t('home.conflictCard', { count: files.length })}
            </span>
            <Button variant="danger" icon="arrow-down" onClick={goResolve}>
              {t('home.resolveConflict')}
            </Button>
          </div>
        </div>
      )}

      {onboardingStep(state) === 'first-project' && (
        <div className="card">
          <div className="row between">
            <span className="cluster">
              <Icon name="folder" size={18} />
              {t('home.firstProject')}
            </span>
            <Button icon="plus" onClick={() => actions.openModal({ kind: 'project-create' })}>
              {t('home.createProject')}
            </Button>
          </div>
        </div>
      )}

      <RecentActivity />

      <AdvancedSync
        ref={advRef}
        open={advOpen}
        onToggle={() => setAdvOpen((o) => !o)}
        files={files}
      />
    </div>
  )
}
