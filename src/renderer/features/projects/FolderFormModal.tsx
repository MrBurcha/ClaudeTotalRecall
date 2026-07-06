import { useState } from 'react'
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
      const err = validateName('ranura', s)
      if (err) {
        setError(err)
        return
      }
    }
    if (!path.trim()) {
      setError('Elegí o pegá una carpeta.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.projectSetFolder(modal.project, s, path.trim())
      await actions.refresh()
      actions.notify(`Carpeta "${s}" guardada en ${modal.project}.`, 'ok')
      actions.closeModal()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={`${editing ? 'Editar' : 'Agregar'} carpeta · ${modal.project}`}
      onClose={actions.closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={actions.closeModal}>
            Cancelar
          </Button>
          <Button variant="primary" icon="check" disabled={submitting || !path.trim()} onClick={submit}>
            {editing ? 'Guardar' : 'Agregar'}
          </Button>
        </>
      }
    >
      <TextField
        label="Ranura"
        value={slot}
        disabled={editing}
        mono
        onChange={(e) => {
          setSlot(e.target.value)
          setError(null)
        }}
        hint={
          editing
            ? 'La ranura no se renombra; quitala y creá otra si querés cambiarla.'
            : 'Nombre lógico de la carpeta (default: memory).'
        }
      />
      <div className="field">
        <span className="field__label">Carpeta en esta máquina</span>
        <div className="row row-nowrap">
          <input
            className="input input--mono grow"
            placeholder="/path/a/la/carpeta"
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setError(null)
            }}
          />
          <Button icon="folder-open" onClick={pick}>
            Elegir…
          </Button>
        </div>
        {error && <span className="field__error">{error}</span>}
      </div>
      <p className="field__hint">El path se guarda literal para esta máquina; en otras puede ser distinto.</p>
    </Modal>
  )
}
