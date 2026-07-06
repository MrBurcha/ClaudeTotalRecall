import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { api } from '../state/api'

/**
 * Barra de título propia: la ventana es frameless. En Linux/Windows dibuja los
 * controles minimizar/maximizar/cerrar; en macOS cede a los semáforos nativos y
 * sólo aporta la franja de arrastre. Toda la barra arrastra la ventana
 * (`-webkit-app-region: drag` en el CSS); los botones se marcan `no-drag`.
 */
export function TitleBar(): JSX.Element {
  const isMac = api.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  // Estado de maximizado: lo pedimos al montar y escuchamos el push del main
  // (mismo patrón de suscripción + cleanup que el motor de sync en store.tsx).
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

  return (
    <div className="titlebar">
      <div className="titlebar__btns">
        <button
          type="button"
          className="titlebar__btn"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => void api.windowMinimize()}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          title={maximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => void api.windowMaximize().then(setMaximized)}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={15} />
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label="Cerrar"
          title="Cerrar"
          onClick={() => void api.windowClose()}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  )
}
