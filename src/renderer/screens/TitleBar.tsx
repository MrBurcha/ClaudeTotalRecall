import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../components/Icon'
import { api } from '../state/api'

/**
 * Custom title bar: the window is frameless. On Linux/Windows it draws the
 * minimize/maximize/close controls; on macOS it defers to the native traffic
 * lights and only provides the drag strip. The whole bar drags the window
 * (`-webkit-app-region: drag` in CSS); the buttons are marked `no-drag`.
 */
export function TitleBar(): JSX.Element {
  const { t } = useTranslation()
  const isMac = api.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  // Maximized state: request it on mount and listen for the push from main
  // (same subscription + cleanup pattern as the sync engine in store.tsx).
  useEffect(() => {
    if (isMac) return
    let alive = true
    void api.windowIsMaximized().then((m) => {
      if (alive) setMaximized(m)
    })
    const off = api.onWindowState((m) => setMaximized(m))
    return () => {
      alive = false
      off()
    }
  }, [isMac])

  if (isMac) return <div className="titlebar titlebar--mac" />

  const maxLabel = maximized ? t('titlebar.restore') : t('titlebar.maximize')

  return (
    <div className="titlebar">
      <div className="titlebar__btns">
        <button
          type="button"
          className="titlebar__btn"
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
          onClick={() => void api.windowMinimize()}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maxLabel}
          title={maxLabel}
          onClick={() => void api.windowMaximize().then(setMaximized)}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={15} />
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
          onClick={() => void api.windowClose()}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  )
}
