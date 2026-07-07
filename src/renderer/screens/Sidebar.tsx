import { useTranslation } from 'react-i18next'
import { StatusDot } from '../components/Badge'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { conflictFiles } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import type { Route } from '../state/types'

const NAV: { route: Route; labelKey: string; icon: IconName }[] = [
  { route: 'home', labelKey: 'nav.home', icon: 'orbit' },
  { route: 'projects', labelKey: 'nav.projects', icon: 'folder' },
  { route: 'settings', labelKey: 'nav.settings', icon: 'sliders' },
]

export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const nConflicts = conflictFiles(state).length

  return (
    <nav className="sidebar">
      <div className="brand">
        <Icon name="orbit" size={22} className="brand__mark" />
        <div>
          <div className="brand__name">Claude Total Recall</div>
        </div>
      </div>

      <div className="nav">
        {NAV.map((n) => (
          <button
            key={n.route}
            className="nav-item"
            aria-current={state.route === n.route ? 'page' : undefined}
            onClick={() => actions.navigate(n.route)}
          >
            <Icon name={n.icon} size={18} />
            <span className="grow">{t(n.labelKey)}</span>
            {n.route === 'home' && nConflicts > 0 && (
              <span className="badge nav-item__badge">{nConflicts}</span>
            )}
          </button>
        ))}
      </div>

      <span className="spacer" />

      <button className="palette-hint" onClick={actions.openPalette}>
        <Icon name="search" size={15} />
        <span className="grow">{t('sidebar.searchAction')}</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="sidebar__foot">
        <div className="row between row-nowrap">
          <span className="pill truncate">
            <StatusDot tone={state.machineId ? 'ok' : 'warn'} />
            {state.machineId ?? t('sidebar.unregistered')}
          </span>
          <IconButton
            icon={state.theme === 'dark' ? 'sun' : 'moon'}
            label={t('sidebar.toggleTheme')}
            onClick={actions.toggleTheme}
          />
        </div>
        <button className="sidebar__version" onClick={() => actions.openModal({ kind: 'about' })}>
          Claude Total Recall v{state.version ?? '—'}
        </button>
      </div>
    </nav>
  )
}
