import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MEMORY_MAINTENANCE_PROMPT } from '../../../core/memoryMaintenance'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { api } from '../../state/api'
import { useActions } from '../../state/useActions'

/**
 * Reusable help modal for reconciling a MEMORY.md index after a cross-machine sync.
 * Opened both from Recent activity (a received MEMORY.md) and when saving a project
 * source that contains a MEMORY.md on a second machine. The copy deliberately splits
 * "when to run it" from "when you can ignore it" — a normal propagated update needs
 * no action.
 */
export function MemoryMaintenanceModal(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await api.clipboardWrite(MEMORY_MAINTENANCE_PROMPT)
      setCopied(true)
    } catch {
      /* clipboard denied — non-fatal, the prompt is still visible to select */
    }
  }

  return (
    <Modal
      title={t('memoryHelp.title')}
      onClose={actions.closeModal}
      size="lg"
      footer={
        <Button variant="ghost" onClick={actions.closeModal}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="stack">
        <p className="muted">{t('memoryHelp.intro')}</p>
        <div className="stack stack-1">
          <span className="label">{t('memoryHelp.whenRunTitle')}</span>
          <p className="muted">{t('memoryHelp.whenRun')}</p>
        </div>
        <div className="stack stack-1">
          <span className="label">{t('memoryHelp.whenIgnoreTitle')}</span>
          <p className="muted">{t('memoryHelp.whenIgnore')}</p>
        </div>
        <p className="muted">{t('memoryHelp.paste')}</p>
        <pre className="memory-prompt mono">{MEMORY_MAINTENANCE_PROMPT}</pre>
        <div className="row">
          <Button size="sm" icon="check" onClick={copy}>
            {t(copied ? 'memoryHelp.copied' : 'memoryHelp.copy')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
