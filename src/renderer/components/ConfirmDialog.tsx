import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { Modal } from './Modal'
import type { ModalDescriptor } from '../state/types'
import { useActions } from '../state/useActions'

/** In-app confirmation; replaces window.confirm. Resolves the confirm() promise. */
export function ConfirmDialog({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'confirm' }>
}): JSX.Element {
  const { t } = useTranslation()
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
            {t('common.cancel')}
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
