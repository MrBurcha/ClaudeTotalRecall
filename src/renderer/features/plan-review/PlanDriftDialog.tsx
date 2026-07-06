import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import type { ModalDescriptor } from '../../state/types'
import { useActions } from '../../state/useActions'

/**
 * Aparece cuando executePlan devuelve drift (el disco cambió entre el preview y
 * la ejecución). Ofrece reconstruir (seguro) o forzar (aplica el plan viejo).
 */
export function PlanDriftDialog({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'plan-drift' }>
}): JSX.Element {
  const { verb, planId, drifted } = modal
  const actions = useActions()

  return (
    <Modal
      title={
        <span className="cluster">
          <Icon name="alert" size={18} />
          El disco cambió
        </span>
      }
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => actions.executePlan(verb, planId, true)}>
            Forzar igual
          </Button>
          <Button variant="primary" icon="sync" onClick={() => actions.rebuildPlan(verb)}>
            Reconstruir
          </Button>
        </>
      }
    >
      <p className="dim">
        Desde que armaste el preview, {drifted.length} archivo(s) cambiaron en disco. El plan que
        confirmaste ya no coincide con lo que hay ahora.
      </p>
      <ul className="plan-list">
        {drifted.map((a) => (
          <li key={a.slot} className="plan-row">
            <span className="plan-row__head">
              <span className="mono truncate">{a.logicalPath}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        <b>Reconstruir</b> arma un preview fresco (recomendado). <b>Forzar</b> aplica el plan viejo
        de todos modos.
      </p>
    </Modal>
  )
}
