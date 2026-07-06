import type { IconName } from '../../components/Icon'
import { canSync, conflicts } from '../../state/selectors'
import type { AppState } from '../../state/types'
import type { Actions } from '../../state/useActions'

export interface Command {
  id: string
  title: string
  subtitle?: string
  icon: IconName
  group: string
  keywords?: string[]
  disabled?: boolean
  run: () => void
}

/**
 * Se computa desde el estado en cada apertura (sin registry mutable global) para
 * que disabled/labels reflejen el contexto y no queden closures viejas.
 */
export function buildCommands(state: AppState, actions: Actions): Command[] {
  const sync = canSync(state)
  const blocked = !sync || conflicts(state).length > 0
  const registered = !!state.machineId

  return [
    {
      id: 'gather',
      title: 'Subir cambios (gather)',
      subtitle: 'máquina → repo',
      icon: 'arrow-up',
      group: 'Sincronizar',
      keywords: ['gather', 'subir', 'push'],
      disabled: blocked,
      run: () => void actions.openPlan('gather'),
    },
    {
      id: 'scatter',
      title: 'Traer cambios (scatter)',
      subtitle: 'repo → máquina',
      icon: 'arrow-down',
      group: 'Sincronizar',
      keywords: ['scatter', 'bajar', 'pull'],
      disabled: blocked,
      run: () => void actions.openPlan('scatter'),
    },
    {
      id: 'refresh',
      title: 'Actualizar estado',
      icon: 'sync',
      group: 'Sincronizar',
      keywords: ['refresh', 'status', 'recargar'],
      run: () => void actions.refresh(),
    },
    { id: 'go-home', title: 'Ir a Sincronización', icon: 'orbit', group: 'Navegar', run: () => actions.navigate('home') },
    { id: 'go-projects', title: 'Ir a Proyectos', icon: 'folder', group: 'Navegar', run: () => actions.navigate('projects') },
    { id: 'go-machines', title: 'Ir a Máquinas', icon: 'monitor', group: 'Navegar', run: () => actions.navigate('machines') },
    { id: 'go-settings', title: 'Ir a Ajustes', icon: 'sliders', group: 'Navegar', run: () => actions.navigate('settings') },
    {
      id: 'new-project',
      title: 'Nuevo proyecto',
      icon: 'plus',
      group: 'Crear',
      keywords: ['proyecto', 'project'],
      disabled: !registered,
      run: () => actions.openModal({ kind: 'project-create' }),
    },
    {
      id: 'theme',
      title: state.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
      icon: state.theme === 'dark' ? 'sun' : 'moon',
      group: 'Apariencia',
      keywords: ['tema', 'theme', 'dark', 'light', 'claro', 'oscuro'],
      run: () => actions.toggleTheme(),
    },
    {
      id: 'about',
      title: 'Acerca de ClaudeTR',
      icon: 'info',
      group: 'Ayuda',
      keywords: ['version', 'acerca', 'about'],
      run: () => actions.openModal({ kind: 'about' }),
    },
  ]
}
