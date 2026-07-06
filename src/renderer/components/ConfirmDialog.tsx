import { Button } from './Button'
import { Modal } from './Modal'
import type { ModalDescriptor } from '../state/types'
import { useActions } from '../state/useActions'

/** Confirmación in-app; reemplaza window.confirm. Resuelve la promesa del confirm(). */
export function ConfirmDialog({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'confirm' }>
}): JSX.Element {
  const actions = useActions()
  const settle = (ok: boolean): void => actions.settleConfirm(modal, ok)

  return (
    <Modal
      title={modal.title}
      size="sm"
      onClose={() => settle(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => settle(false)}>
            Cancelar
          </Button>
          <Button variant={modal.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {modal.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="muted">{modal.body}</p>
    </Modal>
  )
}
