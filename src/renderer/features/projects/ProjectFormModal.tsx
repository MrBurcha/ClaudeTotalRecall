import { useState } from 'react'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Modal } from '../../components/Modal'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

export function ProjectFormModal(): JSX.Element {
  const actions = useActions()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    const n = name.trim()
    const err = validateName('proyecto', n)
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
        setError('Ya existe un proyecto con ese nombre. Asignale un path en su tarjeta.')
        setSubmitting(false)
        return
      }
      actions.notify(`Proyecto "${n}" creado.`, 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="Nuevo proyecto"
      size="sm"
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            Cancelar
          </Button>
          <Button variant="primary" icon="plus" disabled={submitting || !name.trim()} onClick={submit}>
            Crear
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
          label="Nombre lógico"
          placeholder="mi-proyecto"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          hint="Une el proyecto entre tus máquinas (letras, números, . _ -)."
          error={error ?? undefined}
        />
      </form>
    </Modal>
  )
}
