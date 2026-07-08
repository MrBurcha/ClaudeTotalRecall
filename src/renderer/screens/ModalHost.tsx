import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { BrandMark } from '../components/BrandMark'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { PlanDriftDialog } from '../features/plan-review/PlanDriftDialog'
import { PlanReview } from '../features/plan-review/PlanReview'
import { FilePreviewModal } from '../features/preview/FilePreviewModal'
import { ProjectFormModal } from '../features/projects/ProjectFormModal'
import { useAppState } from '../state/store'
import { useActions } from '../state/useActions'

function AboutModal(): JSX.Element {
  const { t } = useTranslation()
  const { version } = useAppState()
  const actions = useActions()
  return (
    <Modal
      title={t('about.title')}
      size="sm"
      onClose={actions.closeModal}
      footer={
        <Button variant="primary" onClick={actions.closeModal}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="cluster">
        <BrandMark size={20} />
        <b>Claude Total Recall</b>
        <span className="pill mono">v{version ?? '—'}</span>
      </div>
      <p className="muted">{t('about.body')}</p>
      <p className="muted cluster">
        <Icon name="lock" size={14} /> {t('about.secrets')}
      </p>
    </Modal>
  )
}

/** Renders the modal on top of the stack (at most one at a time in practice). */
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
    case 'about':
      return <AboutModal />
    case 'file-preview':
      return <FilePreviewModal modal={top} />
    default:
      return null
  }
}
