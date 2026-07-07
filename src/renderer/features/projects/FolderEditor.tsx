import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { SegmentedControl } from '../../components/SegmentedControl'
import { api, normalizeError } from '../../state/api'
import { useActions } from '../../state/useActions'
import { validateName } from './names'

/**
 * Inline source editor for a project slot. A source can be a whole FOLDER
 * (mirrored) or a single FILE (#11). When adding, a segmented control picks the
 * kind; when editing an existing slot the kind is fixed (it is the identity of
 * the synced content). Reuses the native pickers (`projectPickFolder`/`pickFile`).
 */
export function FolderEditor({
  project,
  slot: fixedSlot,
  path: initialPath,
  kind: initialKind,
  onDone,
}: {
  project: string
  slot?: string
  path?: string
  kind?: 'file' | 'dir'
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const editing = fixedSlot !== undefined
  const [slot, setSlot] = useState(fixedSlot ?? 'memory')
  const [kind, setKind] = useState<'file' | 'dir'>(initialKind ?? 'dir')
  const [path, setPath] = useState(initialPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pick = async (): Promise<void> => {
    const chosen = kind === 'file' ? await api.pickFile() : await api.projectPickFolder()
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
      setError(t('projects.pickOrPastePath'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.projectSetFolder(project, s, path.trim(), kind)
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
        {!editing && (
          <SegmentedControl<'dir' | 'file'>
            ariaLabel={t('projects.sourceType')}
            value={kind}
            onChange={(k) => {
              setKind(k)
              setError(null)
            }}
            options={[
              { value: 'dir', label: t('projects.folder') },
              { value: 'file', label: t('projects.file') },
            ]}
          />
        )}
        <input
          className="input input--mono grow"
          placeholder={t(
            kind === 'file' ? 'projects.filePathPlaceholder' : 'projects.folderPathPlaceholder',
          )}
          value={path}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
        />
        <Button
          size="sm"
          icon={kind === 'file' ? 'file-plus' : 'folder-open'}
          disabled={submitting}
          onClick={pick}
        >
          {t(kind === 'file' ? 'projects.chooseFile' : 'projects.chooseFolder')}
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
