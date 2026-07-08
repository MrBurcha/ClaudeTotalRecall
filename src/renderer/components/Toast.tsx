import { useEffect } from 'react'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import type { ToastItem } from '../state/types'

const ICON: Record<ToastItem['kind'], IconName> = {
  ok: 'check',
  err: 'x-circle',
  info: 'info',
}

/** Cada toast agenda su propio auto-dismiss (cleanup-safe bajo StrictMode). */
export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
}): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4600)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className={`toast toast--${toast.kind}`} role="status">
      <Icon name={ICON[toast.kind]} size={17} className="toast__icon" />
      <span className="toast__msg">{toast.msg}</span>
      <IconButton
        icon="x"
        label="Cerrar"
        size={15}
        onClick={() => onDismiss(toast.id)}
        className="toast__close"
      />
    </div>
  )
}
