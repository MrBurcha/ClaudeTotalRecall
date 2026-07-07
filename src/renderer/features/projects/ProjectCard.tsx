import { useTranslation } from 'react-i18next'
import type { Project } from '../../../core/types'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { ProjectFolderRow } from './ProjectFolderRow'

export function ProjectCard({
  name,
  project,
  machineId,
}: {
  name: string
  project: Project
  machineId: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const folders = Object.entries(project.folders)

  const del = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('projects.deleteProject.title'),
      body: t('projects.deleteProject.body', { name }),
      confirmLabel: t('projects.delete'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectDelete(name)
      return t('projects.deleted', { name })
    })
  }

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title">{name}</span>
        <div className="cluster">
          <Button
            size="sm"
            icon="plus"
            disabled={busy || !machineId}
            onClick={() => actions.openModal({ kind: 'folder-form', project: name })}
          >
            {t('projects.folder')}
          </Button>
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={del}>
            {t('projects.delete')}
          </Button>
        </div>
      </div>
      {folders.length === 0 ? (
        <EmptyState icon="folder" title={t('projects.noFoldersYet')}>
          {t('projects.noFoldersHint')}
        </EmptyState>
      ) : (
        <ul className="folder-list">
          {folders.map(([slot, byMachine]) => (
            <ProjectFolderRow
              key={slot}
              project={name}
              slot={slot}
              byMachine={byMachine}
              machineId={machineId}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
