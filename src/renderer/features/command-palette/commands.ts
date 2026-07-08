import type { TFunction } from 'i18next'
import type { IconName } from '../../components/Icon'
import { canSync, hasConflict } from '../../state/selectors'
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
 * Computed from state on every open (no global mutable registry) so disabled/labels
 * reflect the current context and don't keep stale closures. Titles/subtitles/groups
 * are localized via `t`; the `keywords` stay bilingual literals so search works in
 * either language regardless of the active locale.
 */
export function buildCommands(state: AppState, actions: Actions, t: TFunction): Command[] {
  const sync = canSync(state)
  const blocked = !sync || hasConflict(state)
  const registered = !!state.machineId
  const auto = state.syncEngine?.auto ?? true

  return [
    {
      id: 'sync-now',
      title: t('palette.syncNow.title'),
      subtitle: t('palette.syncNow.subtitle'),
      icon: 'sync',
      group: t('palette.group.sync'),
      keywords: ['sync', 'sincronizar', 'ahora', 'now'],
      disabled: blocked,
      run: () => void actions.syncNow(),
    },
    {
      id: 'auto-toggle',
      title: auto ? t('palette.autoToggle.disable') : t('palette.autoToggle.enable'),
      icon: 'sync',
      group: t('palette.group.sync'),
      keywords: ['auto', 'automatico', 'automático', 'toggle'],
      disabled: !registered,
      run: () => void actions.setAutoSync(!auto),
    },
    {
      id: 'outgoing',
      title: t('palette.outgoing.title'),
      subtitle: t('palette.outgoing.subtitle'),
      icon: 'arrow-up',
      group: t('palette.group.sync'),
      keywords: ['outgoing', 'saliente', 'subir', 'push', 'gather', 'avanzado', 'advanced'],
      disabled: blocked,
      run: () => void actions.openPlan('outgoing'),
    },
    {
      id: 'incoming',
      title: t('palette.incoming.title'),
      subtitle: t('palette.incoming.subtitle'),
      icon: 'arrow-down',
      group: t('palette.group.sync'),
      keywords: [
        'incoming',
        'entrante',
        'bajar',
        'traer',
        'pull',
        'scatter',
        'avanzado',
        'advanced',
      ],
      disabled: blocked,
      run: () => void actions.openPlan('incoming'),
    },
    {
      id: 'refresh',
      title: t('palette.refresh.title'),
      icon: 'sync',
      group: t('palette.group.sync'),
      keywords: ['refresh', 'status', 'recargar', 'actualizar'],
      run: () => void actions.refresh(),
    },
    {
      id: 'go-home',
      title: t('palette.goHome'),
      icon: 'sync',
      group: t('palette.group.navigate'),
      keywords: ['home', 'sync', 'inicio', 'sincronizacion'],
      run: () => actions.navigate('home'),
    },
    {
      id: 'go-projects',
      title: t('palette.goProjects'),
      icon: 'folder',
      group: t('palette.group.navigate'),
      keywords: ['projects', 'proyectos'],
      run: () => actions.navigate('projects'),
    },
    {
      id: 'go-machines',
      title: t('palette.goMachines'),
      icon: 'monitor',
      group: t('palette.group.navigate'),
      keywords: ['machines', 'maquinas', 'máquinas'],
      run: () => actions.navigate('settings'),
    },
    {
      id: 'go-settings',
      title: t('palette.goSettings'),
      icon: 'sliders',
      group: t('palette.group.navigate'),
      keywords: ['settings', 'ajustes', 'config'],
      run: () => actions.navigate('settings'),
    },
    {
      id: 'new-project',
      title: t('palette.newProject'),
      icon: 'plus',
      group: t('palette.group.create'),
      keywords: ['proyecto', 'project', 'nuevo', 'new'],
      disabled: !registered,
      run: () => actions.openModal({ kind: 'project-create' }),
    },
    {
      id: 'theme',
      title: state.theme === 'dark' ? t('palette.theme.toLight') : t('palette.theme.toDark'),
      icon: state.theme === 'dark' ? 'sun' : 'moon',
      group: t('palette.group.appearance'),
      keywords: ['tema', 'theme', 'dark', 'light', 'claro', 'oscuro'],
      run: () => actions.toggleTheme(),
    },
    {
      id: 'about',
      title: t('palette.about'),
      icon: 'info',
      group: t('palette.group.help'),
      keywords: ['version', 'acerca', 'about'],
      run: () => actions.openModal({ kind: 'about' }),
    },
  ]
}
