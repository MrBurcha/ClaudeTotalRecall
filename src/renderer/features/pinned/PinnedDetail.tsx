import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FilePreview } from '../../../core/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { Skeleton } from '../../components/Skeleton'
import { api, normalizeError } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { PreviewByName } from '../preview/renderers'
import { needsMemoryHelp, savePinnedPath } from './pinnedApi'
import {
  entryTarget,
  machinePathRows,
  previewFileName,
  type MachinePathRow,
  type PinnedEntry,
} from './pinnedGroups'

/** This machine's path: read-only line, or an inline editor with its own Save/Cancel. */
function ThisMachineRow({ entry, row }: { entry: PinnedEntry; row: MachinePathRow }): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId, busy } = useAppState()
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const start = (): void => {
    setDraft(row.path ?? '')
    setError(null)
    setEditing(true)
  }

  const pick = async (): Promise<void> => {
    const chosen = await api.pickFile()
    if (chosen) {
      setDraft(chosen)
      setError(null)
    }
  }

  const save = async (): Promise<void> => {
    const path = draft.trim()
    if (!path) {
      setError(t('projects.pickOrPastePath'))
      return
    }
    if (path === row.path) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const target = entryTarget(entry)
    try {
      const help = await needsMemoryHelp(config, machineId, target, path)
      await savePinnedPath(target, entry.name, path)
      actions.notify(t('pinned.pathSaved', { name: entry.name }), 'ok')
      await actions.refresh()
      setSaving(false)
      setEditing(false)
      if (help) actions.openModal({ kind: 'memory-maintenance' })
    } catch (e) {
      setError(normalizeError(e))
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <li className="folder-row">
        <div className="folder-editor">
          <div className="row row-nowrap">
            <span className="folder-slot mono">{row.machineId}</span>
            <input
              className="input input--mono grow"
              aria-label={t('pinned.pathOnThisMachine')}
              placeholder={t('projects.filePathPlaceholder')}
              value={draft}
              autoFocus
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                else if (e.key === 'Escape') setEditing(false)
              }}
            />
            <Button size="sm" icon="file-plus" disabled={saving} onClick={pick}>
              {t('projects.chooseFile')}
            </Button>
            <IconButton icon="check" label={t('common.save')} disabled={saving} onClick={save} />
            <IconButton
              icon="x"
              label={t('common.cancel')}
              disabled={saving}
              onClick={() => setEditing(false)}
            />
          </div>
          {error && <div className="field__error folder-editor__err">{error}</div>}
        </div>
      </li>
    )
  }

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <Icon name="monitor" size={14} />
        <span className="folder-slot mono">{row.machineId}</span>
        <Badge>{t('machines.thisMachine')}</Badge>
        {row.path ? (
          <span className="mono grow truncate" title={row.path}>
            {row.path}
          </span>
        ) : (
          <span className="folder-row__missing grow">
            <Icon name="alert" size={14} />
            {t('pinned.noPathHere')}
          </span>
        )}
        <IconButton
          icon="pencil"
          label={row.path ? t('pinned.editPath') : t('pinned.setPath')}
          disabled={busy}
          onClick={start}
        />
      </div>
    </li>
  )
}

/** Another machine's path: read-only (the APIs only edit this machine's mapping). */
function OtherMachineRow({ row }: { row: MachinePathRow }): JSX.Element {
  const { t } = useTranslation()
  const { config } = useAppState()
  const registered = !!config?.machines[row.machineId]
  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <Icon name="monitor" size={14} />
        <span className="folder-slot mono">{row.machineId}</span>
        {!registered && <Badge muted>{t('pinned.unregisteredMachine')}</Badge>}
        {row.path ? (
          <span className="mono grow truncate" title={row.path}>
            {row.path}
          </span>
        ) : (
          <span className="folder-row__missing grow">
            <Icon name="alert" size={14} />
            {t('pinned.notMapped')}
          </span>
        )}
      </div>
    </li>
  )
}

function ContentPreview({
  data,
  error,
  name,
}: {
  data: FilePreview | null
  error: string | null
  name: string
}): JSX.Element {
  const { t } = useTranslation()
  if (error) return <p className="muted note-detail__note">{error}</p>
  if (!data) return <Skeleton h={120} radius={10} />
  if (!data.exists) return <p className="muted note-detail__note">{t('pinned.notInRepo')}</p>
  if (data.binary) {
    return (
      <p className="muted note-detail__note">
        <Icon name="lock" size={15} /> {t('preview.binary')}
      </p>
    )
  }
  if (data.content === '') return <p className="muted note-detail__note">{t('preview.empty')}</p>
  return (
    <div>
      {data.truncated && <p className="muted note-detail__note">{t('preview.truncated')}</p>}
      <PreviewByName name={name} content={data.content} />
    </div>
  )
}

/**
 * Right pane of the Pinned module for one file: where it lives in the repo, its path
 * on every machine (this machine's editable inline), a read-only preview of the
 * synced copy, and removal. Mount it keyed by `entry.key` so state resets per file.
 */
export function PinnedDetail({ entry }: { entry: PinnedEntry }): JSX.Element {
  const { t } = useTranslation()
  const { config, machineId, busy, syncEngine } = useAppState()
  const actions = useActions()
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const general = entry.scope === 'general'
  const current = machineId ? entry.byMachine[machineId] : undefined
  const rows = config ? machinePathRows(config, entry.byMachine, machineId) : []
  // Content comes from the synced working copy: refetch after each sync cycle, and
  // when this machine's path changes (the reveal target is re-derived from it).
  const lastSync = syncEngine?.lastSyncedAt ?? null

  useEffect(() => {
    let alive = true
    api
      .filePreview(entry.key)
      .then((d) => {
        if (!alive) return
        setPreview(d)
        setPreviewError(null)
      })
      .catch((e) => {
        if (alive) setPreviewError(normalizeError(e))
      })
    return () => {
      alive = false
    }
  }, [entry.key, lastSync, current])

  const reveal = async (): Promise<void> => {
    try {
      await api.revealSource(entry.key)
    } catch (e) {
      actions.notify(normalizeError(e), 'err')
    }
  }

  const remove = async (): Promise<void> => {
    if (general) {
      const ok = await actions.confirm({
        title: t('pinned.deleteFile.title'),
        body: t('pinned.deleteFile.body', { pin: entry.name }),
        confirmLabel: t('common.remove'),
        danger: true,
      })
      if (!ok) return
      void actions.run(async () => {
        await api.pinnedRemove(entry.name)
        return t('pinned.removed', { pin: entry.name })
      })
      return
    }
    const project = entry.project ?? ''
    const ok = await actions.confirm({
      title: t('pinned.removeProjectFile.title'),
      body: t('pinned.removeProjectFile.body', { name: entry.name, project }),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectRemoveFolder(project, entry.name)
      return t('projects.folderRemoved', { project, slot: entry.name })
    })
  }

  // A General pin is removed for every machine; a project file only from this one
  // (`project:removeFolder`), so it needs a path here to be removable.
  const canRemove = !!machineId && (general || !!current)

  return (
    <div className="note-detail">
      <div className="note-detail__head">
        <div className="cluster pinned-detail__title">
          <Icon name={general ? 'pin' : 'folder'} size={16} />
          <b className="truncate">{entry.name}</b>
          <Badge muted>{general ? t('pinned.general') : entry.project}</Badge>
        </div>
        {canRemove && (
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={remove}>
            {general ? t('pinned.removeAll') : t('projects.removeFromMachine')}
          </Button>
        )}
      </div>

      <div className="note-detail__body">
        <div className="note-detail__view stack stack-5">
          <section className="stack stack-2">
            <span className="label">{t('pinned.repoLocation')}</span>
            <span className="mono">{entry.key}</span>
          </section>

          <section className="stack stack-1">
            <span className="label">{t('pinned.machinePaths')}</span>
            {!machineId && <p className="muted">{t('pinned.registerFirst')}</p>}
            <ul className="folder-list">
              {rows.map((r) =>
                r.current ? (
                  <ThisMachineRow key={r.machineId} entry={entry} row={r} />
                ) : (
                  <OtherMachineRow key={r.machineId} row={r} />
                ),
              )}
            </ul>
          </section>

          <section className="stack stack-2">
            <div className="row between">
              <span className="label">{t('pinned.content')}</span>
              <Button
                variant="ghost"
                size="sm"
                icon="folder-open"
                disabled={!preview?.sourcePath}
                onClick={reveal}
              >
                {t('preview.openLocation')}
              </Button>
            </div>
            <ContentPreview
              data={preview}
              error={previewError}
              name={previewFileName(entry, machineId)}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
