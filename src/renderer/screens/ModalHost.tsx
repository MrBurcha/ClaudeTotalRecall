import { Button } from '../components/Button'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { PlanDriftDialog } from '../features/plan-review/PlanDriftDialog'
import { PlanReview } from '../features/plan-review/PlanReview'
import { FolderFormModal } from '../features/projects/FolderFormModal'
import { ProjectFormModal } from '../features/projects/ProjectFormModal'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

function AboutModal(): JSX.Element {
  const { version } = useAppState()
  const actions = useActions()
  return (
    <Modal
      title="Acerca de ClaudeTR"
      size="sm"
      onClose={actions.closeModal}
      footer={
        <Button variant="primary" onClick={actions.closeModal}>
          Cerrar
        </Button>
      }
    >
      <div className="cluster">
        <Icon name="orbit" size={20} className="brand__mark" />
        <b>ClaudeTR</b>
        <span className="pill mono">v{version ?? '—'}</span>
      </div>
      <p className="muted">
        Sincroniza la memoria de Claude Code entre tus máquinas vía un repo privado de GitHub.
      </p>
      <p className="muted cluster">
        <Icon name="lock" size={14} /> Nunca viajan secretos: .credentials.json, .claude.json ni
        transcripts (*.jsonl).
      </p>
    </Modal>
  )
}

/** Renderiza el modal del tope del stack (a lo sumo uno a la vez en la práctica). */
export function ModalHost(): JSX.Element | null {
  const { modals } = useAppState()
  const top = modals[modals.length - 1]
  if (!top) return null
  switch (top.kind) {
    case 'confirm':
      return <ConfirmDialog modal={top} />
    case 'plan-review':
      return <PlanReview modal={top} />
    case 'plan-drift':
      return <PlanDriftDialog modal={top} />
    case 'project-create':
      return <ProjectFormModal />
    case 'folder-form':
      return <FolderFormModal modal={top} />
    case 'about':
      return <AboutModal />
    default:
      return null
  }
}
