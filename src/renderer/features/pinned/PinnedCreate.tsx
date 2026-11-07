import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { Icon } from '../../components/Icon'
import { api, normalizeError } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { needsMemoryHelp, savePinnedPath } from './pinnedApi'
import {
  pinnedLogicalPath,
  suggestName,
  takenNames,
  validateFileName,
  type PinnedTarget,
} from './pinnedGroups'

/**
 * Right-pane form to pin a new file: to General (a global pin) or to a project (a
 * file-kind slot). Path first — picking a file suggests the name — then the name it
 * gets in the repo. Only this machine's path is set; other machines map it later.
 */
export function PinnedCreate({
  target,
  onCancel,
  onCreated,
}: {
  target: PinnedTarget
  onCancel: () => void
  onCreated: (key: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId } = useAppState()
  const actions = useActions()
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const general = target.scope === 'general'

  const pick = async (): Promise<void> => {
    const chosen = await api.pickFile()
    if (!chosen) return
    setPath(chosen)
    setError(null)
    if (!name.trim()) {
      setName(suggestName(chosen))
      setNameError(null)
    }
  }

  const submit = async (): Promise<void> => {
    const p = path.trim()
    if (!p) {
      setError(t('projects.pickOrPastePath'))
      return
    }
    const n = name.trim()
    const err = validateFileName(n, config ? takenNames(config, target) : [], t)
    if (err) {
      setNameError(err)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const help = await needsMemoryHelp(config, machineId, target, p)
      await savePinnedPath(target, n, p)
      actions.notify(t('pinned.saved', { pin: n }), 'ok')
      await actions.refresh()
      onCreated(pinnedLogicalPath(target, n))
      if (help) actions.openModal({ kind: 'memory-maintenance' })
    } catch (e) {
      setError(normalizeError(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="note-detail">
      <div className="note-detail__head">
        <div className="cluster pinned-detail__title">
          <Icon name="file-plus" size={16} />
          <b className="truncate">
            {general
              ? t('pinned.create.titleGeneral')
              : t('pinned.create.titleProject', { project: target.project })}
          </b>
        </div>
      </div>
      <div className="note-detail__body">
        <form
          className="note-detail__view stack stack-4 pinned-create"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p className="muted">
            {general ? t('pinned.create.hintGeneral') : t('pinned.create.hintProject')}
          </p>
          <div className="field">
            <span className="field__label">{t('pinned.pathOnThisMachine')}</span>
            <div className="row row-nowrap">
              <input
                className="input input--mono grow"
                aria-label={t('pinned.pathOnThisMachine')}
                placeholder={t('projects.filePathPlaceholder')}
                value={path}
                autoFocus
                onChange={(e) => {
                  setPath(e.target.value)
                  setError(null)
                }}
              />
              <Button size="sm" icon="file-plus" disabled={submitting} onClick={pick}>
                {t('projects.chooseFile')}
              </Button>
            </div>
          </div>
          <TextField
            mono
            label={t('pinned.nameLabel')}
            placeholder={t('pinned.namePlaceholder')}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            hint={t('pinned.create.nameHint', {
              path: pinnedLogicalPath(target, name.trim() || '…'),
            })}
            error={nameError ?? undefined}
          />
          {error && <div className="field__error">{error}</div>}
          <div className="row">
            <Button variant="ghost" disabled={submitting} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" icon="pin" disabled={submitting}>
              {t('pinned.create.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
