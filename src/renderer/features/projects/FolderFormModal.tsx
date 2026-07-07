import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import type { ModalDescriptor } from '../../state/types'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

export function FolderFormModal({
  modal,
}: {
  modal: Extract<ModalDescriptor, { kind: 'folder-form' }>
}): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const editing = !!modal.slot
  const [slot, setSlot] = useState(modal.slot ?? 'memory')
  const [path, setPath] = useState(modal.path ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pick = async (): Promise<void> => {
    const chosen = await api.projectPickFolder()
    if (chosen) {
      setPath(chosen)
      setError(null)
    }
  }

  const submit = async (): Promise<void> => {
    const s = slot.trim()
    if (!editing) {
      const err = validateName('slot', s, t)
      if (err) {
        setError(err)
        return
      }
    }
    if (!path.trim()) {
      setError(t('projects.pickOrPasteFolder'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.projectSetFolder(modal.project, s, path.trim())
      await actions.refresh()
      actions.notify(t('projects.folderSaved', { slot: s, project: modal.project }), 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={t(editing ? 'projects.editFolderTitle' : 'projects.addFolderTitle', {
        project: modal.project,
      })}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check" disabled={submitting || !path.trim()} onClick={submit}>
            {t(editing ? 'common.save' : 'common.add')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('projects.slotLabel')}
        value={slot}
        disabled={editing}
        mono
        onChange={(e) => {
          setSlot(e.target.value)
          setError(null)
        }}
        hint={editing ? t('projects.slotHintEditing') : t('projects.slotHint')}
      />
      <div className="field">
        <span className="field__label">{t('projects.folderOnMachine')}</span>
        <div className="row row-nowrap">
          <input
            className="input input--mono grow"
            placeholder={t('projects.folderPathPlaceholder')}
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setError(null)
            }}
          />
          <Button icon="folder-open" onClick={pick}>
            {t('projects.choose')}
          </Button>
        </div>
        {error && <span className="field__error">{error}</span>}
      </div>
      <p className="field__hint">{t('projects.pathLiteralHint')}</p>
    </Modal>
  )
}
