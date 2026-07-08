import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { Overlay } from './Overlay'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'sm' | 'lg'
  closeOnBackdrop?: boolean
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'modal',
  sm: 'modal modal--sm',
  lg: 'modal modal--lg',
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
      <div className={SIZE_CLASS[size]} role="dialog" aria-modal="true">
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
