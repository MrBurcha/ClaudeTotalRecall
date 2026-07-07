import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

/**
 * Inline folder editor (replaces the old FolderFormModal). Used both to edit an
 * existing folder (slot fixed) and to add a new one (slot editable, default
 * "memory"). Reuses the native folder picker via `api.projectPickFolder`. Errors
 * (e.g. the nesting guard) surface inline; on success it refreshes + closes.
 */
export function FolderEditor({
  project,
  slot: fixedSlot,
  path: initialPath,
  onDone,
}: {
  project: string
  slot?: string
  path?: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const editing = fixedSlot !== undefined
  const [slot, setSlot] = useState(fixedSlot ?? 'memory')
  const [path, setPath] = useState(initialPath ?? '')
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
      await api.projectSetFolder(project, s, path.trim())
      actions.notify(t('projects.folderSaved', { slot: s, project }), 'ok')
      await actions.refresh()
      onDone()
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="folder-editor">
      <div className="row row-nowrap">
        {editing ? (
          <span className="folder-slot mono">{slot}</span>
        ) : (
          <input
            className="input input--mono folder-editor__slot"
            aria-label={t('projects.slotLabel')}
            placeholder="memory"
            value={slot}
            onChange={(e) => {
              setSlot(e.target.value)
              setError(null)
            }}
          />
        )}
        <input
          className="input input--mono grow"
          placeholder={t('projects.folderPathPlaceholder')}
          value={path}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
        />
        <Button size="sm" icon="folder-open" disabled={submitting} onClick={pick}>
          {t('projects.choose')}
        </Button>
        <IconButton
          icon="check"
          label={t(editing ? 'common.save' : 'common.add')}
          disabled={submitting}
          onClick={submit}
        />
        <IconButton icon="x" label={t('common.cancel')} disabled={submitting} onClick={onDone} />
      </div>
      {error && <div className="field__error folder-editor__err">{error}</div>}
    </div>
  )
}
