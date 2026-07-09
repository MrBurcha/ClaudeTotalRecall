import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { api } from '../../state/api'
import { useAppState } from '../../state/store'
import { useActions } from '../../state/useActions'
import { FolderEditor } from './FolderEditor'

export function ProjectFolderRow({
  project,
  slot,
  byMachine,
  kind,
  machineId,
}: {
  project: string
  slot: string
  byMachine: Record<string, string>
  kind: 'file' | 'dir'
  machineId: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const { busy } = useAppState()
  const actions = useActions()
  const [editing, setEditing] = useState(false)
  const current = machineId ? byMachine[machineId] : undefined
  const others = Object.keys(byMachine).filter((m) => m !== machineId)

  const remove = async (): Promise<void> => {
    const ok = await actions.confirm({
      title: t('projects.removeFolder.title'),
      body: t('projects.removeFolder.body', { slot }),
      confirmLabel: t('common.remove'),
      danger: true,
    })
    if (!ok) return
    void actions.run(async () => {
      await api.projectRemoveFolder(project, slot)
      return t('projects.folderRemoved', { project, slot })
    })
  }

  if (editing) {
    return (
      <li className="folder-row">
        <FolderEditor
          project={project}
          slot={slot}
          path={current}
          kind={kind}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="folder-row">
      <div className="folder-row__main">
        <Icon name={kind === 'file' ? 'file-diff' : 'folder'} size={14} />
        <span className="folder-slot mono">{slot}</span>
        {current ? (
          <span className="mono grow truncate">{current}</span>
        ) : (
          <span className="folder-row__missing grow">
            <Icon name="alert" size={14} />
            {t('projects.noPathOnMachine')}
          </span>
        )}
        <IconButton
          icon="pencil"
          label={t('projects.editFolder')}
          disabled={busy}
          onClick={() => setEditing(true)}
        />
        {current && (
          <IconButton
            icon="trash"
            label={t('projects.removeFromMachine')}
            disabled={busy}
            onClick={remove}
          />
        )}
      </div>
      {others.length > 0 && (
        <div className="muted mono folder-row__others">
          {t('projects.alsoOn', { machines: others.join(', ') })}
        </div>
      )}
    </li>
  )
}
