import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ProjectItem } from '../features/projects/ProjectItem'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

export function Projects(): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId } = useAppState()
  const actions = useActions()
  const projects = config ? Object.entries(config.projects) : []

  return (
    <div className="view">
      <ViewHeader
        eyebrow={t('projects.eyebrow')}
        title={t('projects.title')}
        sub={t('projects.sub')}
        action={
          <Button
            variant="primary"
            icon="plus"
            disabled={!machineId}
            onClick={() => actions.openModal({ kind: 'project-create' })}
          >
            {t('projects.newProject')}
          </Button>
        }
      />

      {!machineId && (
        <div className="card">
          <EmptyState icon="monitor" title={t('projects.registerMachineFirst')}>
            {t('projects.registerMachineHint')}
          </EmptyState>
        </div>
      )}

      {machineId && projects.length === 0 && (
        <div className="card">
          <EmptyState icon="folder" title={t('projects.noProjectsYet')}>
            {t('projects.noProjectsHint')}
          </EmptyState>
        </div>
      )}

      {projects.length > 0 && (
        <div className="project-list">
          {projects.map(([name, project]) => (
            <ProjectItem key={name} name={name} project={project} machineId={machineId} />
          ))}
        </div>
      )}
    </div>
  )
}
