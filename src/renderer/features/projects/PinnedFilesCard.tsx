import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api, normalizeError } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'

/** Inline editor to create a pinned file (pinId editable) or edit its path. */
function PinnedEditor({
  pinId: fixedPin,
  path: initialPath,
  onDone,
}: {
  pinId?: string
  path?: string
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const actions = useActions()
  const editing = fixedPin !== undefined
  const [pinId, setPinId] = useState(fixedPin ?? '')
  const [path, setPath] = useState(initialPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const pick = async (): Promise<void> => {
    const chosen = await api.pickFile()
    if (chosen) {
      setPath(chosen)
      setError(null)
    }
  }

  const submit = async (): Promise<void> => {
    const id = pinId.trim()
    if (!editing && !id) {
      setError(t('pinned.nameRequired'))
      return
    }
    if (!path.trim()) {
      setError(t('projects.pickOrPastePath'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.pinnedSet(id, path.trim())
      actions.notify(t('pinned.saved', { pin: id }), 'ok')
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
          <span className="folder-slot mono">{pinId}</span>
        ) : (
          <input
            className="input input--mono folder-editor__slot"
            aria-label={t('pinned.nameLabel')}
            placeholder={t('pinned.namePlaceholder')}
            value={pinId}
            onChange={(e) => {
              setPinId(e.target.value)
              setError(null)
            }}
          />
        )}
        <input
          className="input input--mono grow"
          placeholder={t('projects.filePathPlaceholder')}
          value={path}
          onChange={(e) => {
            setPath(e.target.value)
            setError(null)
          }}
        />
        <Button size="sm" icon="file-plus" disabled={submitting} onClick={pick}>
          {t('projects.chooseFile')}
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

function PinnedRow({
  pinId,
  byMachine,
  machineId,
}: {
  pinId: string
  byMachine: Record<string, string>
  machineId: string
}): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const current = byMachine[machineId]
  const others = Object.keys(byMachine).filter((m) => m !== machineId)

  const remove = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('pinned.deleteFile.title'),
      body: t('pinned.deleteFile.body', { pin: pinId }),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.pinnedRemove(pinId)
      return t('pinned.removed', { pin: pinId })
    })
  }

  if (editing) {
    return (
      <li className="folder-row">
        <PinnedEditor pinId={pinId} path={current} onDone={() => setEditing(false)} />
      </li>
    )
  }

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <Icon name="file-diff" size={14} />
        <span className="folder-slot mono">{pinId}</span>
        {current ? (
          <span className="mono grow truncate">{current}</span>
        ) : (
          <span className="muted grow">{t('pinned.noPathHere')}</span>
        )}
        <IconButton
          icon="pencil"
          label={t('pinned.editPath')}
          disabled={busy}
          onClick={() => setEditing(true)}
        />
        <IconButton icon="trash" label={t('pinned.remove')} disabled={busy} onClick={remove} />
      </div>
      {others.length > 0 && (
        <div className="muted mono folder-row__others">
          {t('projects.alsoOn', { machines: others.join(', ') })}
        </div>
      )}
    </li>
  )
}

/**
 * Settings card for global pinned files (#11): single files synced outside any
 * project (e.g. a specific CLAUDE.md). CRUD per row, mirroring the Projects design.
 */
export function PinnedFilesCard(): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId, busy } = useAppState()
  const [adding, setAdding] = useState(false)
  const pins = config ? Object.entries(config.pinnedFiles ?? {}) : []

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__title">{t('pinned.title')}</span>
      </div>
      <p className="muted">{t('pinned.sub')}</p>

      {!machineId ? (
        <p className="muted">{t('pinned.registerFirst')}</p>
      ) : (
        <>
          {pins.length === 0 && !adding ? (
            <p className="muted">{t('pinned.empty')}</p>
          ) : (
            <ul className="folder-list">
              {pins.map(([pinId, byMachine]) => (
                <PinnedRow key={pinId} pinId={pinId} byMachine={byMachine} machineId={machineId} />
              ))}
            </ul>
          )}
          {adding ? (
            <PinnedEditor onDone={() => setAdding(false)} />
          ) : (
            <div className="row">
              <Button size="sm" icon="file-plus" disabled={busy} onClick={() => setAdding(true)}>
                {t('pinned.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
