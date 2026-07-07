import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../core/types'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api, normalizeError } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { FolderEditor } from './FolderEditor'
import { ProjectFolderRow } from './ProjectFolderRow'
import { validateName } from './names'

/**
 * One project as a collapsible list row (#12). Collapsed = name + folder count;
 * expanded = an inline CRUD panel: rename the project, edit/add/remove folders
 * (all in place, no modals), and delete the project. Each action saves on its own
 * and confirms destructive ones. Open/edit state is local.
 */
export function ProjectItem({
  name,
  project,
  machineId,
}: {
  name: string
  project: Project
  machineId: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const folders = Object.entries(project.folders)

  const [open, setOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [adding, setAdding] = useState(false)

  const startRename = (): void => {
    setDraftName(name)
    setNameError(null)
    setEditingName(true)
  }

  const saveName = async (): Promise<void> => {
    const v = draftName.trim()
    const err = validateName('project', v, t)
    if (err) {
      setNameError(err)
      return
    }
    if (v === name) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    setNameError(null)
    try {
      await api.projectRename(name, v)
      actions.notify(t('projects.renamed', { to: v }), 'ok')
      await actions.refresh() // re-renders the list under the new name (unmounts this row)
    } catch (e) {
      setNameError(normalizeError(e))
      setSavingName(false)
    }
  }

  const del = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('projects.deleteProject.title'),
      body: t('projects.deleteProject.body', { name }),
      confirmLabel: t('projects.delete'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectDelete(name)
      return t('projects.deleted', { name })
    })
  }

  return (
    <div className="project-item">
      <button
        className="project-item__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="project-item__name grow">{name}</span>
        <span className="muted">{t('projects.folderCount', { count: folders.length })}</span>
      </button>

      {open && (
        <div className="project-item__body stack">
          <div className="stack stack-1">
            <span className="label">{t('projects.nameLabel')}</span>
            {editingName ? (
              <div className="row row-nowrap">
                <input
                  className="input input--mono grow"
                  value={draftName}
                  autoFocus
                  onChange={(e) => {
                    setDraftName(e.target.value)
                    setNameError(null)
                  }}
                />
                <IconButton
                  icon="check"
                  label={t('common.save')}
                  disabled={savingName}
                  onClick={saveName}
                />
                <IconButton
                  icon="x"
                  label={t('common.cancel')}
                  disabled={savingName}
                  onClick={() => setEditingName(false)}
                />
              </div>
            ) : (
              <div className="row row-nowrap">
                <span className="mono grow">{name}</span>
                <IconButton
                  icon="pencil"
                  label={t('common.edit')}
                  disabled={busy}
                  onClick={startRename}
                />
              </div>
            )}
            {nameError && <span className="field__error">{nameError}</span>}
          </div>

          <div className="stack stack-2">
            <span className="label">{t('projects.folderCount', { count: folders.length })}</span>
            {folders.length === 0 && !adding ? (
              <p className="muted">{t('projects.noFoldersHint')}</p>
            ) : (
              <ul className="folder-list">
                {folders.map(([slot, byMachine]) => (
                  <ProjectFolderRow
                    key={slot}
                    project={name}
                    slot={slot}
                    byMachine={byMachine}
                    machineId={machineId}
                  />
                ))}
              </ul>
            )}
            {adding ? (
              <FolderEditor project={name} onDone={() => setAdding(false)} />
            ) : (
              <div className="row">
                <Button size="sm" icon="plus" disabled={busy} onClick={() => setAdding(true)}>
                  {t('projects.folder')}
                </Button>
              </div>
            )}
          </div>

          <div className="row">
            <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={del}>
              {t('projects.delete')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
