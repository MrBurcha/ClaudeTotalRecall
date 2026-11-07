import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { unassociatedProjects } from '../../core/nameMatch'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { SegmentedControl } from '../components/SegmentedControl'
import { ProjectItem } from '../features/projects/ProjectItem'
import { ProjectsOverview } from '../features/projects/ProjectsOverview'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

/** "By project" = the editable accordion list; "All paths" = the read-only overview (#114). */
type ProjectsView = 'byProject' | 'allPaths'

export function Projects(): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId } = useAppState()
  const actions = useActions()
  const projects = config ? Object.entries(config.projects) : []
  // Projects configured on other machines but not associated here → invite adoption.
  const unassociated = config && machineId ? unassociatedProjects(config, machineId) : []
  const [focus, setFocus] = useState<{ name: string; tick: number } | null>(null)
  const focusProject = (name: string): void => setFocus((f) => ({ name, tick: (f?.tick ?? 0) + 1 }))
  const [view, setView] = useState<ProjectsView>('byProject')
  // From the overview: back to the editable list, opened and scrolled to that project.
  const openProject = (name: string): void => {
    setView('byProject')
    focusProject(name)
  }

  return (
    <div className="view">
      <ViewHeader
        eyebrow={t('projects.eyebrow')}
        title={t('projects.title')}
        sub={t('projects.sub')}
        action={
          <div className="cluster">
            <SegmentedControl<ProjectsView>
              ariaLabel={t('projects.view.aria')}
              value={view}
              onChange={setView}
              options={[
                { value: 'byProject', label: t('projects.view.byProject') },
                { value: 'allPaths', label: t('projects.view.allPaths') },
              ]}
            />
            <Button
              variant="primary"
              icon="plus"
              disabled={!machineId}
              onClick={() => actions.openModal({ kind: 'project-new' })}
            >
              {t('projects.newProject')}
            </Button>
          </div>
        }
      />

      {view === 'allPaths' && <ProjectsOverview onOpenProject={openProject} />}

      {view === 'byProject' && !machineId && (
        <div className="card">
          <EmptyState icon="monitor" title={t('projects.registerMachineFirst')}>
            {t('projects.registerMachineHint')}
          </EmptyState>
        </div>
      )}

      {view === 'byProject' && machineId && projects.length === 0 && (
        <div className="card">
          <EmptyState icon="folder" title={t('projects.noProjectsYet')}>
            {t('projects.noProjectsHint')}
          </EmptyState>
        </div>
      )}

      {view === 'byProject' && unassociated.length > 0 && (
        <div className="card card--accent">
          <div className="card__head">
            <span className="card__title cluster">
              <Icon name="alert" size={16} />
              {t('projects.unassociatedTitle', { count: unassociated.length })}
            </span>
          </div>
          <p className="muted">{t('projects.unassociatedHint')}</p>
          <div className="cluster">
            {unassociated.map((name) => (
              <button
                key={name}
                type="button"
                className="link-accent"
                title={t('projects.focusProject', { name })}
                onClick={() => focusProject(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'byProject' && projects.length > 0 && (
        <div className="project-list">
          {projects.map(([name, project]) => (
            <ProjectItem
              key={name}
              name={name}
              project={project}
              machineId={machineId}
              focusTick={focus?.name === name ? focus.tick : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
