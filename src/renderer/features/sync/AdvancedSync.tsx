import { forwardRef } from 'react'
import { StatusDot } from '../../components/Badge'
import { Icon } from '../../components/Icon'
import { Kbd } from '../../components/Kbd'
import { canSync } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { ConflictResolver } from '../conflicts/ConflictResolver'

/** Tecla de consola para forzar una dirección a mano (con preview de Plan). */
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

/**
 * Panel "Avanzado" colapsable dentro de Sincronización: lo que antes era la vista
 * entera (gather/scatter con revisión de Plan + resolución de conflictos). Se
 * auto-despliega ante un conflicto; el CTA rojo scrollea hasta acá.
 */
export const AdvancedSync = forwardRef<
  HTMLElement,
  { open: boolean; onToggle: () => void; files: string[] }
>(function AdvancedSync({ open, onToggle, files }, ref) {
  const state = useAppState()
  const actions = useActions()
  const { status, busy } = state
  const blocked = !canSync(state) || busy || files.length > 0

  return (
    <section className="advanced" ref={ref}>
      <button className="advanced__head" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="grow">
          <span className="advanced__title">Avanzado</span>
          <span className="muted"> — forzar cambios, ida y vuelta manual, conflictos</span>
        </span>
      </button>

      {open && (
        <div className="advanced__body stack">
          {files.length > 0 && <ConflictResolver files={files} />}

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

          <div className="sync-keys">
            <SyncKey
              verb="gather"
              shortcut="⌘G"
              hint={
                status && status.ahead > 0
                  ? `máquina → repo · ${status.ahead} para subir`
                  : 'máquina → repo'
              }
              disabled={blocked}
              onClick={() => void actions.openPlan('gather')}
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
              onClick={() => void actions.openPlan('scatter')}
            />
          </div>
        </div>
      )}
    </section>
  )
})
