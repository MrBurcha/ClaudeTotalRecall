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
  const { busy } = useAppState()
  const actions = useActions()
  const folders = Object.entries(project.folders)

  const del = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: 'Eliminar proyecto',
      body: `¿Eliminar "${name}" para todas las máquinas? No borra tus carpetas locales, solo la configuración de sincronización.`,
      confirmLabel: 'Eliminar',
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectDelete(name)
      return `Proyecto "${name}" eliminado.`
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
            Carpeta
          </Button>
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={del}>
            Eliminar
          </Button>
        </div>
      </div>
      {folders.length === 0 ? (
        <EmptyState icon="folder" title="Sin carpetas todavía">
          Agregá una carpeta para que este proyecto sincronice en esta máquina.
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
