import { useEffect, useRef, useState } from 'react'
import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import { Constellation } from '../features/constellation/Constellation'
import { AdvancedSync } from '../features/sync/AdvancedSync'
import { AutoToggle } from '../features/sync/AutoToggle'
import { SyncNowButton } from '../features/sync/SyncNowButton'
import { relativeTime } from '../features/sync/relativeTime'
import { conflictFiles, engineTone, hasConflict, onboardingStep } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

/** Texto de estado de la barra según el motor. */
function statusLabel(state: ReturnType<typeof useAppState>): string {
  if (hasConflict(state)) return 'Conflicto'
  const eng = state.syncEngine
  if (!eng) return 'Cargando…'
  if (eng.status === 'syncing') return 'Sincronizando…'
  if (eng.status === 'offline') return 'Sin conexión'
  return 'Al día'
}

function statusMeta(state: ReturnType<typeof useAppState>, now: number): string {
  const eng = state.syncEngine
  if (hasConflict(state)) {
    const n = conflictFiles(state).length
    return `${n} archivo${n === 1 ? '' : 's'} por resolver`
  }
  if (!eng) return ''
  if (eng.status === 'syncing') return 'poniendo todo en orden…'
  if (eng.status === 'offline') return 'sin conexión, reintenta solo'
  const bits: string[] = []
  if (eng.lastSyncedAt) bits.push(`última vez ${relativeTime(eng.lastSyncedAt, now)}`)
  bits.push(eng.auto ? 'automático activado' : 'automático desactivado')
  return bits.join(' · ')
}

export function SyncHome(): JSX.Element {
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

  // Refresca el "hace X" del último sync sin depender de un evento del backend.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])

  const goResolve = (): void => {
    setAdvOpen(true)
    requestAnimationFrame(() => advRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const dotTone = conflict ? 'danger' : tone === 'offline' ? 'warn' : syncEngine?.auto ? 'ok' : 'muted'

  return (
    <div className="view">
      <div className="view__head">
        <span className="view__eyebrow">Estación de sincronización</span>
        <h1 className="view__title">Tu memoria, sincronizada sola</h1>
        <p className="view__sub">
          ClaudeTR mantiene la memoria de Claude Code al día entre tus máquinas: sube al instante
          cuando editás y baja del repo cada pocos minutos. Sin apretar nada.
        </p>
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
            <span className="sync-bar__state">{statusLabel(state)}</span>
            <span className="sync-bar__meta muted mono">{statusMeta(state, now)}</span>
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
              La sincronización está frenada por {files.length} conflicto
              {files.length === 1 ? '' : 's'}. Resolvelo para que siga sola.
            </span>
            <Button variant="danger" icon="arrow-down" onClick={goResolve}>
              Resolver conflicto
            </Button>
          </div>
        </div>
      )}

      {onboardingStep(state) === 'first-project' && (
        <div className="card">
          <div className="row between">
            <span className="cluster">
              <Icon name="folder" size={18} />
              ¿Sumás tu primer proyecto para sincronizar carpetas específicas?
            </span>
            <Button icon="plus" onClick={() => actions.openModal({ kind: 'project-create' })}>
              Crear proyecto
            </Button>
          </div>
        </div>
      )}

      <AdvancedSync ref={advRef} open={advOpen} onToggle={() => setAdvOpen((o) => !o)} files={files} />
    </div>
  )
}
