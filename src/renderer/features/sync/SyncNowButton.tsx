import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { canSync, hasConflict } from '../../state/selectors'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/**
 * Primary button of the simple view: triggers a full engine cycle. Works even if
 * auto is off; it's disabled while running or if there's a conflict (in that case
 * it's resolved through the Advanced panel).
 */
export function SyncNowButton(): JSX.Element {
  const { t } = useTranslation()
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
      {syncing ? t('sync.syncing') : t('sync.syncNow')}
    </Button>
  )
}
