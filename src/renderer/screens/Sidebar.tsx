import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { StatusDot } from '../components/Badge'
import { BrandMark } from '../components/BrandMark'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { conflictFiles, sidebarNotice, type SidebarNotice } from '../state/selectors'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import type { Route } from '../state/types'

const NAV: { route: Route; labelKey: string; icon: IconName }[] = [
  { route: 'home', labelKey: 'nav.home', icon: 'sync' },
  { route: 'projects', labelKey: 'nav.projects', icon: 'folder' },
  { route: 'pinned', labelKey: 'nav.pinned', icon: 'pin' },
  { route: 'notebook', labelKey: 'nav.notebook', icon: 'book' },
  { route: 'settings', labelKey: 'nav.settings', icon: 'sliders' },
]

function noticeMessage(notice: SidebarNotice, t: TFunction): string {
  if (notice.kind === 'update') {
    return t('sidebar.updateBanner.message', { version: notice.latestVersion })
  }
  return notice.latestVersion
    ? t('sidebar.wrongBuild.messageWithUpdate', { version: notice.latestVersion })
    : t('sidebar.wrongBuild.message')
}

/** Names the exact installer the link points to (#134); generic when it's the releases page. */
function noticeAction(notice: SidebarNotice, t: TFunction): string {
  switch (notice.variant) {
    case 'macos-arm64':
      return t('sidebar.download.appleSilicon')
    case 'macos-x64':
      return t('sidebar.download.intel')
    case 'windows-setup':
      return t('sidebar.download.windows')
    case 'windows-portable':
      return t('sidebar.download.windowsPortable')
    case 'linux-appimage':
      return t('sidebar.download.appImage')
    default:
      return notice.kind === 'wrongBuild'
        ? t('sidebar.wrongBuild.action')
        : t('sidebar.updateBanner.action')
  }
}

export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const state = useAppState()
  const actions = useActions()
  const nConflicts = conflictFiles(state).length
  const notice = sidebarNotice(state)

  return (
    <nav className="sidebar">
      <div className="brand">
        <BrandMark size={22} />
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
        {notice && (
          <div
            className={`sidebar__notice${notice.kind === 'wrongBuild' ? ' sidebar__notice--warn' : ''}`}
            role="status"
          >
            <span className="sidebar__notice-msg">
              <Icon name={notice.kind === 'wrongBuild' ? 'alert' : 'info'} size={14} />
              <span>{noticeMessage(notice, t)}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={actions.openReleaseNotice}>
              {noticeAction(notice, t)}
            </Button>
          </div>
        )}
        <button className="sidebar__version" onClick={() => actions.openModal({ kind: 'about' })}>
          Claude Total Recall v{state.version ?? '—'}
        </button>
      </div>
    </nav>
  )
}
