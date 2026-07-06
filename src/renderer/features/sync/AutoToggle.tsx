import { canSync } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Switch de sincronización automática. Refleja `syncEngine.auto` y lo cambia por
 * IPC; el nuevo estado vuelve por el push del motor. Deshabilitado hasta que la
 * máquina esté lista para sincronizar.
 */
export function AutoToggle(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const eng = state.syncEngine
  const auto = eng?.auto ?? true
  const disabled = !eng || !canSync(state)

  return (
    <label className={`switch${disabled ? ' switch--disabled' : ''}`}>
      <input
        type="checkbox"
        className="switch__input"
        checked={auto}
        disabled={disabled}
        onChange={(e) => void actions.setAutoSync(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">Automático</span>
    </label>
  )
}
