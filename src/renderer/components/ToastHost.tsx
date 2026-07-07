import { Toast } from './Toast'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

/** Renders the toast queue (the 3 most recent) at the bottom right. */
export function ToastHost(): JSX.Element | null {
  const { toasts } = useAppState()
  const { dismissToast } = useActions()
  if (toasts.length === 0) return null
  return (
    <div className="toast-host">
      {toasts.slice(-3).map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  )
}
