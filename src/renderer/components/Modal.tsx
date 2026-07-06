import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { Overlay } from './Overlay'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'sm'
  closeOnBackdrop?: boolean
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps): JSX.Element {
  return (
    <Overlay onClose={onClose} closeOnBackdrop={closeOnBackdrop}>
      <div className={size === 'sm' ? 'modal modal--sm' : 'modal'} role="dialog" aria-modal="true">
        <div className="modal__head">
          <div className="row between row-nowrap">
            <h2 className="modal__title grow">{title}</h2>
            <IconButton icon="x" label="Cerrar" onClick={onClose} />
          </div>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </Overlay>
  )
}
