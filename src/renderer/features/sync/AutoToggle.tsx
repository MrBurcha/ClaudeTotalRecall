import { useTranslation } from 'react-i18next'
import { canSync } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Automatic sync switch. Reflects `syncEngine.auto` and toggles it over IPC; the
 * new state comes back via the engine push. Disabled until the machine is ready
 * to sync.
 */
export function AutoToggle(): JSX.Element {
  const { t } = useTranslation()
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
      <span className="switch__label">{t('sync.automatic')}</span>
    </label>
  )
}
