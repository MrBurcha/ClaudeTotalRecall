import { Button } from '../../components/Button'
import { canSync, hasConflict } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Botón primario de la vista simple: dispara un ciclo completo del motor. Funciona
 * aunque el auto esté apagado; se deshabilita mientras corre o si hay conflicto
 * (en ese caso se resuelve por el panel Avanzado).
 */
export function SyncNowButton(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const syncing = state.syncEngine?.status === 'syncing'
  const disabled = !canSync(state) || syncing || hasConflict(state)

  return (
    <Button
      variant="primary"
      icon="sync"
      className={syncing ? 'is-syncing' : undefined}
      disabled={disabled}
      onClick={() => void actions.syncNow()}
    >
      {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
    </Button>
  )
}
