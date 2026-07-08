import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useActions } from '../../state/useActions'

/**
 * The "New project" hub: three ways to add a project — scan ~/.claude/projects in
 * bulk, discover one selected folder, or create an empty project. Each option
 * closes this modal and opens the corresponding flow.
 */
export function ProjectNewChooser(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()

  const openScan = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-scan' })
  }
  const openDiscover = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-discover' })
  }
  const openCreate = (): void => {
    actions.closeModal()
    actions.openModal({ kind: 'project-create' })
  }

  return (
    <Modal
      title={t('projects.new.title')}
      size="sm"
      onClose={actions.closeModal}
      footer={
        <Button variant="ghost" onClick={actions.closeModal}>
          {t('common.cancel')}
        </Button>
      }
    >
      <div className="stack">
        <div className="stack stack-1">
          <Button variant="primary" icon="search" onClick={openScan}>
            {t('projects.new.scan')}
          </Button>
          <span className="muted">{t('projects.new.scanHint')}</span>
        </div>
        <div className="stack stack-1">
          <Button icon="folder-open" onClick={openDiscover}>
            {t('projects.new.folder')}
          </Button>
          <span className="muted">{t('projects.new.folderHint')}</span>
        </div>
        <div className="stack stack-1">
          <Button icon="plus" onClick={openCreate}>
            {t('projects.new.empty')}
          </Button>
          <span className="muted">{t('projects.new.emptyHint')}</span>
        </div>
      </div>
    </Modal>
  )
}
