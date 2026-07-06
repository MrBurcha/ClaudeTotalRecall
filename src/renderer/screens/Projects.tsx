import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { ProjectCard } from '../features/projects/ProjectCard'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'
import { ViewHeader } from './ViewHeader'

export function Projects(): JSX.Element {
  const { config, machineId } = useAppState()
  const actions = useActions()
  const projects = config ? Object.entries(config.projects) : []

  return (
    <div className="view">
      <ViewHeader
        eyebrow="Configuración"
        title="Proyectos"
        sub="Un proyecto agrupa carpetas de memoria; el path de cada carpeta se guarda literal por máquina."
        action={
          <Button
            variant="primary"
            icon="plus"
            disabled={!machineId}
            onClick={() => actions.openModal({ kind: 'project-create' })}
          >
            Nuevo proyecto
          </Button>
        }
      />

      {!machineId && (
        <div className="card">
          <EmptyState icon="monitor" title="Registrá esta máquina primero">
            Necesitás registrar esta computadora antes de asignar carpetas.
          </EmptyState>
        </div>
      )}

      {machineId && projects.length === 0 && (
        <div className="card">
          <EmptyState icon="folder" title="Ningún proyecto todavía">
            Creá uno para sincronizar carpetas de memoria específicas.
          </EmptyState>
        </div>
      )}

      {projects.map(([name, project]) => (
        <ProjectCard key={name} name={name} project={project} machineId={machineId} />
      ))}
    </div>
  )
}
