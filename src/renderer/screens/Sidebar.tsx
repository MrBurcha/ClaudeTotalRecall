import { StatusDot } from '../components/Badge'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { conflicts } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import type { Route } from '../state/types'

const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: 'home', label: 'Sincronización', icon: 'orbit' },
  { route: 'projects', label: 'Proyectos', icon: 'folder' },
  { route: 'machines', label: 'Máquinas', icon: 'monitor' },
  { route: 'settings', label: 'Ajustes', icon: 'sliders' },
]

export function Sidebar(): JSX.Element {
  const state = useAppState()
  const actions = useActions()
  const nConflicts = conflicts(state).length

  return (
    <nav className="sidebar">
      <div className="brand">
        <Icon name="orbit" size={22} className="brand__mark" />
        <div>
          <div className="brand__name">ClaudeTR</div>
          <span className="brand__tag">total recall</span>
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
            <span className="grow">{n.label}</span>
            {n.route === 'home' && nConflicts > 0 && (
              <span className="badge nav-item__badge">{nConflicts}</span>
            )}
          </button>
        ))}
      </div>

      <span className="spacer" />

      <button className="palette-hint" onClick={actions.openPalette}>
        <Icon name="search" size={15} />
        <span className="grow">Buscar acción</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="sidebar__foot">
        <div className="row between row-nowrap">
          <span className="pill truncate">
            <StatusDot tone={state.machineId ? 'ok' : 'warn'} />
            {state.machineId ?? 'sin registrar'}
          </span>
          <IconButton
            icon={state.theme === 'dark' ? 'sun' : 'moon'}
            label="Cambiar tema"
            onClick={actions.toggleTheme}
          />
        </div>
        <button className="sidebar__version" onClick={() => actions.openModal({ kind: 'about' })}>
          ClaudeTR v{state.version ?? '—'}
        </button>
      </div>
    </nav>
  )
}
