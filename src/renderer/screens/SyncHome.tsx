import { StatusDot } from '../components/Badge'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { Kbd } from '../components/Kbd'
import { Skeleton } from '../components/Skeleton'
import { Constellation } from '../features/constellation/Constellation'
import { ConflictResolver } from '../features/conflicts/ConflictResolver'
import { canSync, conflicts, onboardingStep } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

function SyncKey({
  verb,
  hint,
  shortcut,
  disabled,
  onClick,
}: {
  verb: 'gather' | 'scatter'
  hint: string
  shortcut: string
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  const gather = verb === 'gather'
  return (
    <button className="sync-key" disabled={disabled} onClick={onClick}>
      <span className="sync-key__icon">
        <Icon name={gather ? 'arrow-up' : 'arrow-down'} size={22} />
      </span>
      <span className="sync-key__text">
        <span className="sync-key__title">{gather ? 'Gather' : 'Scatter'}</span>
        <span className="sync-key__sub">{hint}</span>
      </span>
      <Kbd>{shortcut}</Kbd>
    </button>
  )
}

export function SyncHome(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const { config, status, machineId, activeOp, busy, loading } = state
  const sync = canSync(state)
  const files = conflicts(state)
  const blocked = !sync || busy || files.length > 0

  return (
    <div className="view">
      <div className="view__head">
        <span className="view__eyebrow">Estación de sincronización</span>
        <h1 className="view__title">Tu memoria, en órbita</h1>
        <p className="view__sub">
          Subí los cambios de esta máquina al repo (gather) o traé lo último a esta máquina
          (scatter). Cada acción muestra un preview antes de tocar disco.
        </p>
      </div>

      {files.length > 0 && <ConflictResolver files={files} />}

      {loading ? (
        <Skeleton h={300} radius={14} />
      ) : (
        <Constellation
          machines={config?.machines ?? {}}
          currentId={machineId}
          status={status}
          activeOp={activeOp}
        />
      )}

      <div className="telemetry">
        <div className="telem">
          <span className="telem__label">Rama</span>
          <span className="telem__value">
            <Icon name="git-branch" size={14} />
            {status?.branch ?? '—'}
          </span>
        </div>
        <div className="telem">
          <span className="telem__label">Para subir</span>
          <span className="telem__value nums">
            <Icon name="arrow-up" size={14} />
            {status?.ahead ?? 0}
          </span>
        </div>
        <div className="telem">
          <span className="telem__label">Por bajar</span>
          <span className="telem__value nums">
            <Icon name="arrow-down" size={14} />
            {status?.behind ?? 0}
          </span>
        </div>
        <div className="telem">
          <span className="telem__label">Estado</span>
          <span className="telem__value">
            <StatusDot tone={status ? (status.dirty ? 'warn' : 'ok') : 'muted'} />
            {status ? (status.dirty ? 'con cambios' : 'limpio') : '—'}
          </span>
        </div>
        <div className="telem">
          <span className="telem__label">Secretos</span>
          <span className="telem__value">
            <Icon name="lock" size={14} />
            excluidos
          </span>
        </div>
      </div>

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

      <div className="sync-keys">
        <SyncKey
          verb="gather"
          shortcut="⌘G"
          hint={
            status && status.ahead > 0 ? `máquina → repo · ${status.ahead} para subir` : 'máquina → repo'
          }
          disabled={blocked}
          onClick={() => actions.openPlan('gather')}
        />
        <SyncKey
          verb="scatter"
          shortcut="⌘S"
          hint={
            status && status.behind > 0
              ? `repo → máquina · ${status.behind} por bajar`
              : 'repo → máquina'
          }
          disabled={blocked}
          onClick={() => actions.openPlan('scatter')}
        />
      </div>
    </div>
  )
}
