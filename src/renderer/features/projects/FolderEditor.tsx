import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { IconButton } from '../../components/IconButton'
import { SegmentedControl } from '../../components/SegmentedControl'
import { api, normalizeError } from '../../state/api'
import { useAppState } from '../../state/store'
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
  const { config, machineId } = useAppState()
  const editing = fixedSlot !== undefined
  const [slot, setSlot] = useState(fixedSlot ?? 'memory')
  const [kind, setKind] = useState<'file' | 'dir'>(initialKind ?? 'dir')
  const [path, setPath] = useState(initialPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A pending "we redirected your pick to <leaf>/" suggestion, and whether the
  // user insisted on their literal path (so we stop re-suggesting).
  const [notice, setNotice] = useState<{ leaf: string; original: string } | null>(null)
  const [override, setOverride] = useState(false)

  const pick = async (): Promise<void> => {
    const chosen = kind === 'file' ? await api.pickFile() : await api.projectPickFolder()
    if (!chosen) return
    setError(null)
    setOverride(false)
    if (kind === 'file') {
      setPath(chosen)
      setNotice(null)
      return
    }
    // Redirect a picked project root to its <slot> child so it maps flat, not
    // nested (memories/…/memory/memory/…). Falls back to the raw pick on error.
    try {
      const c = await api.projectSuggestFolderCorrection(project, slot.trim(), chosen, kind)
      setPath(c.path)
      setNotice(c.redirected ? { leaf: c.expectedLeaf, original: chosen } : null)
    } catch {
      setPath(chosen)
      setNotice(null)
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
    // A typed/pasted dir path never went through pick(): offer the same redirect
    // once. `notice`/`override` guard against re-suggesting (and any revert loop).
    if (kind === 'dir' && !notice && !override) {
      try {
        const c = await api.projectSuggestFolderCorrection(project, s, path.trim(), kind)
        if (c.redirected) {
          setPath(c.path)
          setNotice({ leaf: c.expectedLeaf, original: path.trim() })
          return
        }
      } catch {
        /* non-fatal — fall through and save the path as-is */
      }
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.projectSetFolder(project, s, path.trim(), kind)
      actions.notify(t('projects.folderSaved', { slot: s, project }), 'ok')
      // If this project already lives on another machine and the source we just
      // saved carries a MEMORY.md, the index may now be out of sync — offer the pass.
      const otherMachineHasProject = Object.values(config?.projects[project]?.folders ?? {}).some(
        (byMachine) => Object.keys(byMachine).some((m) => m !== machineId),
      )
      const showMemoryHelp =
        otherMachineHasProject &&
        (await api.projectFolderHasMemoryIndex(path.trim(), kind).catch(() => false))
      await actions.refresh()
      onDone()
      if (showMemoryHelp) actions.openModal({ kind: 'memory-maintenance' })
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
              setNotice(null)
              setOverride(false)
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
            setNotice(null)
            setOverride(false)
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
      {notice && (
        <div className="folder-editor__notice field__hint field__hint--accent">
          <span>{t('projects.folderRedirect.adjusted', { leaf: notice.leaf })}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={() => {
              setPath(notice.original)
              setNotice(null)
              setOverride(true)
            }}
          >
            {t('projects.folderRedirect.revert')}
          </Button>
        </div>
      )}
      {error && <div className="field__error folder-editor__err">{error}</div>}
    </div>
  )
}
