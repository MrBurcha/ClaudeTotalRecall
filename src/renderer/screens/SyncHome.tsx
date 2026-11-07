import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import { Constellation } from '../features/constellation/Constellation'
import { AdvancedSync } from '../features/sync/AdvancedSync'
import { AutoToggle } from '../features/sync/AutoToggle'
import { RecentActivity } from '../features/sync/RecentActivity'
import { SyncErrorDetails } from '../features/sync/SyncErrorDetails'
import { SyncNowButton } from '../features/sync/SyncNowButton'
import { summarizeSync } from '../features/sync/syncSummary'
import { conflictFiles, engineTone, hasConflict, onboardingStep } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

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

  // What the bar says (#139): "Up to date" only when it's true.
  const summary = summarizeSync(syncEngine, conflict ? files.length : 0, now, t)
  const dotTone = summary.tone
  // The failure text, while the bar shows a failure (never stale under "syncing").
  const failure =
    !conflict && (syncEngine?.status === 'error' || syncEngine?.status === 'offline')
      ? syncEngine.lastError
      : null

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
          pending={syncEngine?.pending ?? null}
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
            <span className="sync-bar__state">{summary.label}</span>
            <span className="sync-bar__meta muted mono">{summary.meta}</span>
          </div>
        </div>
        <div className="cluster">
          {summary.offerAutoOn && (
            <Button variant="ghost" icon="sync" onClick={() => void actions.setAutoSync(true)}>
              {t('home.turnAutoOn')}
            </Button>
          )}
          <AutoToggle />
          <SyncNowButton />
        </div>
        {failure && <SyncErrorDetails error={failure} />}
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
