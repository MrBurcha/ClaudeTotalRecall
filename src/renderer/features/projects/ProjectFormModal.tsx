import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

export function ProjectFormModal(): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    const n = name.trim()
    const err = validateName('project', n, t)
    if (err) {
      setError(err)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { alreadyExists } = await api.projectCreate(n)
      await actions.refresh()
      if (alreadyExists) {
        setError(t('projects.alreadyExists'))
        setSubmitting(false)
        return
      }
      actions.notify(t('projects.created', { name: n }), 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={t('projects.newProject')}
      size="sm"
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="plus" disabled={submitting || !name.trim()} onClick={submit}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField
          label={t('projects.logicalName')}
          placeholder={t('projects.projectNamePlaceholder')}
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          hint={t('projects.projectNameHint')}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  )
}
